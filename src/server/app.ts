import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import type { DB } from "./db";
import { gmailAccounts, users } from "./db/schema";
import type { Env } from "./env";
import { requireEnv } from "./env";
import { encryptSecret, randomToken, signPayload, verifyPayload } from "./lib/crypto";
import { authUrl, exchangeCode, idTokenClaims } from "./lib/gmail";
import { ensureUser, seedDemoMailbox } from "./lib/users";
import { threadRoutes } from "./routes/threads";
import { taskRoutes } from "./routes/tasks";
import { miscRoutes } from "./routes/misc";

export type AppEnv = {
  Bindings: Env;
  Variables: { db: DB; userId: string; demo: boolean };
};

const SESSION_COOKIE = "wd_session";
const STATE_COOKIE = "wd_oauth_state";
const SESSION_DAYS = 30;

type Options = {
  getDb: (env: Env) => DB | Promise<DB>;
  // Local development only: with no Google credentials configured, sign in as a demo user.
  allowDemo: boolean;
};

const isDemo = (env: Env, opts: Options) => opts.allowDemo && !env.GOOGLE_CLIENT_ID;

export function createApp(opts: Options) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: err.message || "Server error" }, 500);
  });

  app.use(async (c, next) => {
    c.set("db", await opts.getDb(c.env));
    c.set("demo", isDemo(c.env, opts));
    await next();
  });

  // --- Sign-in with Google (also connects Gmail read-only) ---

  const redirectUri = (env: Env) => `${requireEnv(env, "APP_URL").replace(/\/$/, "")}/api/auth/google/callback`;
  const secure = (env: Env) => (env.APP_URL ?? "").startsWith("https://");

  app.get("/auth/google", (c) => {
    const state = randomToken();
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
    if (!tokens.scope?.includes("gmail.readonly")) return fail("Gmail read access was not granted.");

    const db = c.get("db");
    const { user } = await ensureUser(db, email, claims.name);
    const values: Partial<typeof gmailAccounts.$inferInsert> = {};
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
    return c.redirect(appUrl);
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // --- Everything below requires a signed-in user ---

  app.use(async (c, next) => {
    const db = c.get("db");
    if (c.get("demo")) {
      const { user, created } = await ensureUser(db, "demo@localhost", "Demo user");
      if (created) await seedDemoMailbox(db, user.id);
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
  app.route("/tasks", taskRoutes);
  app.route("/", miscRoutes);

  return app;
}
