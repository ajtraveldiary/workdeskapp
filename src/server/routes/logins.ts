// Saved website logins (user request 2026-10-11): SPARK-style sites with a login per employee, BiMS-style sites
// with shared DDO / section clerk logins. Passwords are AES-GCM encrypted with TOKEN_ENC_KEY, never included in
// lists, and only returned by POST /:id/reveal when the user taps Show or Copy (a POST, so neither the service
// worker's offline copy nor the browser's saved data keeps it). Every change and every reveal goes in History.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import type { Env } from "../env";
import { employees, events, siteLogins } from "../db/schema";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import { siteLoginInput } from "../../shared/schemas";
import type { SiteLogin } from "../../shared/types";

// Without TOKEN_ENC_KEY (only the local demo) the password is kept as "plain:…"; a real sign-in always has the key.
async function seal(env: Env, demo: boolean, password: string) {
  if (env.TOKEN_ENC_KEY) return encryptSecret(password, env.TOKEN_ENC_KEY);
  if (demo) return `plain:${password}`;
  throw new HTTPException(500, { message: "TOKEN_ENC_KEY is not set, so passwords can't be saved safely" });
}
async function unseal(env: Env, stored: string) {
  if (stored.startsWith("plain:")) return stored.slice(6);
  if (!env.TOKEN_ENC_KEY) throw new HTTPException(500, { message: "TOKEN_ENC_KEY is not set" });
  return decryptSecret(stored, env.TOKEN_ENC_KEY);
}

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });
const label = (l: { website: string; loginId: string; assignedTo: string }) => [l.website, l.loginId || l.assignedTo].filter(Boolean).join(" · ");

function selectLogins(db: DB) {
  return db
    .select({ login: siteLogins, employeeName: employees.name })
    .from(siteLogins)
    .leftJoin(employees, eq(siteLogins.employeeId, employees.id));
}
const toLogin = ({ login: l, employeeName }: { login: typeof siteLogins.$inferSelect; employeeName: string | null }): SiteLogin => ({
  id: l.id,
  website: l.website,
  url: l.url,
  employeeId: l.employeeId,
  assignedTo: employeeName ?? l.assignedTo,
  loginId: l.loginId,
  hasPassword: !!l.passwordEnc,
  remarks: l.remarks,
  updatedAt: l.updatedAt.toISOString(),
});

async function load(db: DB, userId: string, id: string) {
  const [l] = await db.select().from(siteLogins).where(and(eq(siteLogins.id, id), eq(siteLogins.userId, userId)));
  if (!l) throw new HTTPException(404, { message: "Login not found" });
  return l;
}

// The assigned person: an employee of this user (their name is kept too), or the role / name typed in.
async function assignee(db: DB, userId: string, employeeId: string | null, typed: string) {
  if (!employeeId) return { employeeId: null, assignedTo: typed };
  const [e] = await db.select({ name: employees.name }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.userId, userId)));
  if (!e) throw new HTTPException(400, { message: "Employee not found" });
  return { employeeId, assignedTo: e.name };
}

export const loginRoutes = new Hono<AppEnv>()
  // ?employee=<id> lists only that employee's logins (their page).
  .get("/", async (c) => {
    const userId = c.get("userId");
    const employee = c.req.query("employee");
    const rows = await selectLogins(c.get("db"))
      .where(and(eq(siteLogins.userId, userId), employee ? eq(siteLogins.employeeId, employee) : undefined))
      .orderBy(asc(siteLogins.website), asc(siteLogins.assignedTo), asc(siteLogins.loginId));
    return c.json({ logins: rows.map(toLogin) });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { password, employeeId, assignedTo, ...input } = siteLoginInput.parse(await c.req.json());
    const who = await assignee(db, userId, employeeId, assignedTo);
    const passwordEnc = password ? await seal(c.env, c.get("demo"), password) : null;
    const [l] = await db.insert(siteLogins).values({ ...input, ...who, passwordEnc, userId }).returning();
    await log(db, userId, "logins.added", `Login saved: ${label(l!)}`);
    return c.json({ id: l!.id }, 201);
  })

  .put("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const l = await load(db, userId, c.req.param("id"));
    const { password, employeeId, assignedTo, ...input } = siteLoginInput.parse(await c.req.json());
    const who = await assignee(db, userId, employeeId, assignedTo);
    // Left out = keep the saved password; "" or null = remove it; anything else replaces it.
    const passwordEnc = password === undefined ? l.passwordEnc : password ? await seal(c.env, c.get("demo"), password) : null;
    await db.update(siteLogins).set({ ...input, ...who, passwordEnc, updatedAt: new Date() }).where(eq(siteLogins.id, l.id));
    const changedPassword = password !== undefined && passwordEnc !== l.passwordEnc;
    await log(db, userId, "logins.changed", `Login ${changedPassword ? (passwordEnc ? "password changed" : "password removed") : "changed"}: ${label({ ...input, ...who })}`);
    return c.json({ ok: true });
  })

  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const l = await load(db, userId, c.req.param("id"));
    await db.delete(siteLogins).where(eq(siteLogins.id, l.id));
    await log(db, userId, "logins.removed", `Login removed: ${label(l)}`);
    return c.json({ ok: true });
  })

  // The password, for Show or Copy. Noted in History each time.
  .post("/:id/reveal", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const l = await load(db, userId, c.req.param("id"));
    if (!l.passwordEnc) throw new HTTPException(404, { message: "No password saved for this login" });
    const { copy } = (await c.req.json().catch(() => ({}))) as { copy?: boolean };
    const password = await unseal(c.env, l.passwordEnc);
    const [e] = l.employeeId ? await db.select({ name: employees.name }).from(employees).where(eq(employees.id, l.employeeId)) : [];
    await log(db, userId, copy ? "logins.copied" : "logins.shown", `Password ${copy ? "copied" : "shown"}: ${label({ ...l, assignedTo: e?.name ?? l.assignedTo })}`);
    c.header("Cache-Control", "no-store");
    return c.json({ password });
  });
