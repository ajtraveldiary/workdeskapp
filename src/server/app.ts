import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import type { DB } from "./db";
import { gmailAccounts, users } from "./db/schema";
import type { Env } from "./env";
import { requireEnv, timezone } from "./env";
import { encryptSecret, randomToken, signPayload, verifyPayload } from "./lib/crypto";
import { authUrl, exchangeCode, idTokenClaims } from "./lib/gmail";
import { ensureUser, seedDemoMailbox, seedDemoReports } from "./lib/users";
import { todayIn } from "./lib/dates";
import { DB_ERROR_MESSAGE, classifyDbError } from "./lib/dbErrors";
import { calendarFeedRoute, calendarSettingsRoutes } from "./routes/calendar";
import { threadRoutes } from "./routes/threads";
import { taskRoutes } from "./routes/tasks";
import { miscRoutes } from "./routes/misc";
import { reportRoutes } from "./routes/reports";
import { labelRoutes, threadLabelRoute } from "./routes/labels";
import { pushRoutes } from "./routes/push";
import { staffRoutes } from "./routes/staff";
import { fileRoutes } from "./routes/files";
import { loginRoutes } from "./routes/logins";
import { tagRoutes } from "./routes/tags";
import { officeEventRoutes } from "./routes/officeEvents";
import { eventTypeRoutes } from "./routes/eventTypes";
import { moveRoutes } from "./routes/moves";
import { entryRoutes, registerRoutes } from "./routes/registers";
import { linkedEmailRoutes } from "./routes/linkedEmails";
import { transferRoutes } from "./routes/transfer";
import { assistantRoutes } from "./routes/assistant";
import { officeProfileRoutes } from "./routes/officeProfile";
import { queueRoutes } from "./routes/queue";
import { authorizationServerMetadata, oauthRoutes, protectedResourceMetadata } from "./mcp/oauth";
import { mcpRoutes } from "./mcp/server";

export type AppEnv = {
  Bindings: Env;
  Variables: { db: DB; userId: string; demo: boolean };
};

const SESSION_COOKIE = "wd_session";
const STATE_COOKIE = "wd_oauth_state";
// Where to go after Google sign-in when it started from an assistant's consent page (MCP, 2026-10-18).
const RETURN_COOKIE = "wd_return";
const RETURN_OK = /^\/api\/oauth\/authorize\?\S*$/;
const SESSION_DAYS = 30;

type Options = {
  getDb: (env: Env) => DB | Promise<DB>;
  // Local development only: with no Google credentials configured, sign in as a demo user.
  allowDemo: boolean;
};

const isDemo = (env: Env, opts: Options) => opts.allowDemo && !env.GOOGLE_CLIENT_ID;

export function createApp(opts: Options) {
  // The root app holds only the sign-in details assistants look up at /.well-known/ (MCP, 2026-10-18); everything
  // else is under /api. Both share one router.
  const root = new Hono<AppEnv>();
  const app = root.basePath("/api");

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    // Database down or paused (Neon usage limit): a clear message and a code the app shows a pop-up for.
    const db = classifyDbError(err);
    if (db) return c.json({ error: DB_ERROR_MESSAGE[db.code], code: db.code, detail: db.detail }, 503);
    return c.json({ error: err.message || "Server error" }, 500);
  });

  app.use(async (c, next) => {
    c.set("db", await opts.getDb(c.env));
    c.set("demo", isDemo(c.env, opts));
    await next();
  });

  // --- Sign-in with Google (also connects Gmail: reading, plus marking opened emails read) ---

  const redirectUri = (env: Env) => `${requireEnv(env, "APP_URL").replace(/\/$/, "")}/api/auth/google/callback`;
  const secure = (env: Env) => (env.APP_URL ?? "").startsWith("https://");

  app.get("/auth/google", (c) => {
    const state = randomToken();
    // Signing in to approve an assistant: come back to its consent page afterwards.
    const back = c.req.query("return");
    if (back && RETURN_OK.test(back)) setCookie(c, RETURN_COOKIE, back, { httpOnly: true, secure: secure(c.env), sameSite: "Lax", path: "/api/auth", maxAge: 600 });
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: secure(c.env),
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: 600,
    });
    return c.redirect(authUrl(requireEnv(c.env, "GOOGLE_CLIENT_ID"), redirectUri(c.env), state, c.env.OWNER_EMAIL));
  });

  app.get("/auth/google/callback", async (c) => {
    const env = c.env;
    const appUrl = requireEnv(env, "APP_URL");
    const fail = (reason: string) => c.redirect(`${appUrl}/?auth_error=${encodeURIComponent(reason)}`);

    const state = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });
    if (!state || state !== c.req.query("state")) return fail("Sign-in expired, please try again.");
    const code = c.req.query("code");
    if (!code) return fail(c.req.query("error") ?? "Sign-in was cancelled.");

    const tokens = await exchangeCode(
      requireEnv(env, "GOOGLE_CLIENT_ID"),
      requireEnv(env, "GOOGLE_CLIENT_SECRET"),
      code,
      redirectUri(env),
    );
    const claims = idTokenClaims(tokens.id_token ?? "");
    const email = claims.email?.toLowerCase();
    if (!email || !claims.email_verified) return fail("Google did not return a verified email.");
    if (email !== requireEnv(env, "OWNER_EMAIL").toLowerCase()) return fail(`${email} is not allowed to use this WorkDesk.`);
    if (!/gmail\.(readonly|modify)/.test(tokens.scope ?? "")) return fail("Gmail access was not granted.");

    const db = c.get("db");
    const { user } = await ensureUser(db, email, claims.name);
    if (claims.picture) await db.update(users).set({ picture: claims.picture }).where(eq(users.id, user.id));
    const values: Partial<typeof gmailAccounts.$inferInsert> = { grantedScopes: tokens.scope ?? null };
    if (tokens.refresh_token) values.refreshTokenEnc = await encryptSecret(tokens.refresh_token, requireEnv(env, "TOKEN_ENC_KEY"));
    await db
      .insert(gmailAccounts)
      .values({ userId: user.id, email, ...values })
      .onConflictDoUpdate({ target: gmailAccounts.email, set: { ...values, lastSyncError: null } });

    const session = await signPayload(
      { uid: user.id, exp: Date.now() + SESSION_DAYS * 86400_000 },
      requireEnv(env, "SESSION_SECRET"),
    );
    setCookie(c, SESSION_COOKIE, session, {
      httpOnly: true,
      secure: secure(env),
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    });
    const back = getCookie(c, RETURN_COOKIE);
    if (back) deleteCookie(c, RETURN_COOKIE, { path: "/api/auth" });
    return c.redirect(back && RETURN_OK.test(back) ? `${appUrl.replace(/\/$/, "")}${back}` : appUrl);
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // Private calendar feed for Apple Calendar etc.: no sign-in, the secret link is the key (2026-10-07).
  app.route("/", calendarFeedRoute);

  // --- Assistants (MCP server, user request 2026-10-18; docs/MCP_PLAN.md) ---
  // Sign-in details at the site root, the sign-in itself under /api/oauth and the MCP endpoint at /api/mcp; each
  // checks who is asking itself (the consent page uses the app's sign-in, the MCP endpoint an access token).
  const open = cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "Mcp-Protocol-Version", "Mcp-Session-Id"], exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id"], maxAge: 86400 });
  root.use("/.well-known/*", open);
  for (const p of ["/oauth-protected-resource", "/oauth-protected-resource/api/mcp"]) root.get(`/.well-known${p}`, (c) => c.json(protectedResourceMetadata(c)));
  for (const p of ["/oauth-authorization-server", "/oauth-authorization-server/api/mcp", "/openid-configuration"]) root.get(`/.well-known${p}`, (c) => c.json(authorizationServerMetadata(c)));
  app.use("/mcp", open);
  for (const p of ["/oauth/token", "/oauth/register", "/oauth/revoke"]) app.use(p, open);
  const demoUserId = async (c: Context<AppEnv>) => {
    const { user, created } = await ensureUser(c.get("db"), "demo@localhost", "Demo user");
    if (created) {
      await seedDemoMailbox(c.get("db"), user.id);
      await seedDemoReports(c.get("db"), user.id, todayIn(timezone(c.env)));
    }
    return user.id;
  };
  app.route("/oauth", oauthRoutes(demoUserId));
  app.route("/mcp", mcpRoutes(app));

  // --- Everything below requires a signed-in user ---

  app.use(async (c, next) => {
    const db = c.get("db");
    if (c.get("demo")) {
      const { user, created } = await ensureUser(db, "demo@localhost", "Demo user");
      if (created) {
        await seedDemoMailbox(db, user.id);
        await seedDemoReports(db, user.id, todayIn(timezone(c.env)));
      }
      c.set("userId", user.id);
      return next();
    }
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await verifyPayload<{ uid: string; exp: number }>(token, requireEnv(c.env, "SESSION_SECRET")) : null;
    if (!session || session.exp < Date.now()) return c.json({ error: "Not signed in" }, 401);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, session.uid));
    if (!user) return c.json({ error: "Not signed in" }, 401);
    c.set("userId", user.id);
    return next();
  });

  app.route("/threads", threadRoutes);
  app.route("/threads", threadLabelRoute);
  app.route("/labels", labelRoutes);
  app.route("/tasks", taskRoutes);
  app.route("/reports", reportRoutes);
  app.route("/push", pushRoutes);
  app.route("/staff", staffRoutes);
  app.route("/files", fileRoutes);
  app.route("/logins", loginRoutes);
  app.route("/tags", tagRoutes);
  app.route("/office-events", officeEventRoutes);
  app.route("/event-types", eventTypeRoutes);
  app.route("/moves", moveRoutes);
  app.route("/registers", registerRoutes);
  app.route("/register-entries", entryRoutes);
  app.route("/linked-emails", linkedEmailRoutes);
  app.route("/transfer", transferRoutes);
  app.route("/assistant", assistantRoutes);
  app.route("/office-profile", officeProfileRoutes);
  app.route("/queue", queueRoutes);
  app.route("/", miscRoutes);
  app.route("/", calendarSettingsRoutes);

  return app;
}
