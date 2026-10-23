// Calls log and saved changes (user request 2026-10-23, "every subrequest made from any part of this website must be
// logged in this queue, and if failed stored there for retry"): each request's outgoing calls are logged as one row
// (what they were, never the data in them), a change that fails is saved and done again through the app, one that
// had already saved part of itself waits for the user's check, reads are only logged, and refused phone
// notifications are sent again.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import type { Env } from "../src/server/env";
import { encryptSecret, signPayload } from "../src/server/lib/crypto";
import { b64url } from "../src/server/lib/webpush";
import { describeCall, installCallCounter, newBudget, withCalls } from "../src/server/lib/callBudget";
import { notSavedReason, saveFailedChange, writeCallLog } from "../src/server/lib/callLog";
import { pushToUser } from "../src/server/lib/notify";
import { runQueue } from "../src/server/lib/queue";
import { createApp } from "../src/server/app";
import type { CallEntry, CallLog, QueueInfo } from "../src/shared/types";

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const base: Env = { TOKEN_ENC_KEY: KEY, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", SESSION_SECRET: "s".repeat(32), APP_TIMEZONE: "Asia/Kolkata" };

// A simulated Gmail and push service; the counter wraps this fetch once for the whole file.
let gmailFails = false;
let pushStatus = 201;
async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "tok", expires_in: 3600 });
  if (url.hostname === "web.push.apple.com") return new Response(null, { status: pushStatus });
  if (gmailFails) return json({ error: "backend" }, 500);
  const path = url.pathname.replace("/gmail/v1/users/me", "");
  if (path === "/labels" && init?.method === "POST") {
    const b = JSON.parse(String(init.body)) as { name: string };
    return json({ id: "Label_9", name: b.name });
  }
  if (path.startsWith("/threads/")) return json({ id: "t1", messages: [] });
  return json({ error: "unexpected" }, 500);
}

let db: DB;
let userId: string;
let app: ReturnType<typeof createApp>;
let cookie: string;
const call = async (method: string, path: string, body?: unknown, env: Env = base) => {
  const res = await app.request(`/api${path}`, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }, env);
  const text = await res.text();
  return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
};
const logs = () => db.select().from(schema.callLogs);
const jobsOf = (kind: "action" | "push") => db.select().from(schema.jobs).where(eq(schema.jobs.kind, kind));

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  installCallCounter();
});

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as DB;
  userId = (await db.insert(schema.users).values({ email: "clerk@example.gov" }).returning())[0]!.id;
  await db.insert(schema.gmailAccounts).values({ userId, email: "clerk@example.gov", refreshTokenEnc: await encryptSecret("refresh", KEY), grantedScopes: "https://www.googleapis.com/auth/gmail.modify" });
  app = createApp({ getDb: () => db, allowDemo: false });
  cookie = `wd_session=${await signPayload({ uid: userId, exp: Date.now() + 3600_000 }, base.SESSION_SECRET!)}`;
  gmailFails = false;
  pushStatus = 201;
});

afterEach(() => vi.useRealTimers());

describe("what a call is logged as", () => {
  it("names each call without the data in it", () => {
    const neon = (query: string) => describeCall("https://ep-x.neon.tech/sql", { method: "POST", headers: { "Neon-Connection-String": "postgres://u:pw@h/db" }, body: JSON.stringify({ query, params: ["ജില്ലാ മെഡിക്കൽ ഓഫീസർ", "secret-token"] }) });
    expect(neon('insert into "tasks" ("title") values ($1)')).toMatchObject({ kind: "db", what: "insert tasks", write: true });
    expect(neon('select "id" from "email_threads" where "user_id" = $1')).toMatchObject({ kind: "db", what: "select email_threads", write: false });
    expect(neon('update "jobs" set "status" = $1')).toMatchObject({ what: "update jobs", write: true });
    expect(JSON.stringify(neon('insert into "tasks" ("title") values ($1)'))).not.toMatch(/secret-token|ജില്ലാ|pw@/);
    expect(describeCall("https://gmail.googleapis.com/gmail/v1/users/me/threads/abc?format=full")).toEqual({ kind: "gmail", what: "GET /threads/abc", write: false, repeatable: false });
    expect(describeCall("https://gmail.googleapis.com/gmail/v1/users/me/threads/abc/modify", { method: "POST" })).toMatchObject({ write: true, repeatable: true });
    expect(describeCall("https://oauth2.googleapis.com/token", { method: "POST", body: "refresh_token=x" })).toEqual({ kind: "google", what: "Google sign-in refresh", write: false });
    expect(describeCall("https://web.push.apple.com/abc", { method: "POST", headers: { "content-encoding": "aes128gcm" } })).toMatchObject({ kind: "push", what: "Push via web.push.apple.com" });
  });

  it("never saves passwords, sign-in secrets, imports or the queue's own buttons for retry", () => {
    expect(notSavedReason("/api/logins/abc")).toMatch(/password/);
    expect(notSavedReason("/api/oauth/token")).toBeTruthy();
    expect(notSavedReason("/api/transfer/backup")).toBeTruthy();
    expect(notSavedReason("/api/queue/run")).toBeTruthy();
    expect(notSavedReason("/api/tasks")).toBeNull();
  });
});

describe("calls log", () => {
  it("writes one row per request with every call, and marks the queue's own checks", async () => {
    gmailFails = false;
    const t = (await db.insert(schema.emailThreads).values({ userId, gmailThreadId: "t1", subject: "Leave", lastMessageAt: new Date(), accountId: (await db.select().from(schema.gmailAccounts))[0]!.id }).returning())[0]!;
    expect((await call("GET", `/threads/${t.id}/content`)).status).toBe(200);
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "app", request: `GET /api/threads/${t.id}/content`, status: 200, failed: 0, userId });
    // The Gmail sign-in is cached between requests, so the refresh may or may not be in this one.
    expect(rows[0]!.entries.map((e) => e.what)).toContain("GET /threads/t1");

    const b = newBudget(50);
    b.log.push({ at: 0, ms: 1, kind: "db", what: "select jobs", write: false, ok: true });
    await writeCallLog(db, b, { userId, source: "app", method: "GET", path: "/api/queue", status: 200 });
    expect((await logs()).find((r) => r.request === "GET /api/queue")!.selfCheck).toBe(true);

    // Settings › Queue › Calls log hides the queue's own checks unless asked.
    const shown = (await call("GET", "/queue/calls")).json.calls as CallLog[];
    expect(shown.map((r) => r.title)).toEqual(["Open email"]);
    expect(((await call("GET", "/queue/calls?self=1")).json.calls as CallLog[]).map((r) => r.title)).toContain("Queue check");
  });

  it("a failed read is logged but not saved for retry", async () => {
    const t = (await db.insert(schema.emailThreads).values({ userId, gmailThreadId: "t1", subject: "Leave", lastMessageAt: new Date(), accountId: (await db.select().from(schema.gmailAccounts))[0]!.id }).returning())[0]!;
    gmailFails = true;
    expect((await call("GET", `/threads/${t.id}/content`)).status).toBe(500);
    const [row] = await logs();
    expect(row!.failed).toBeGreaterThan(0);
    expect(row!.jobId).toBeNull();
    expect(await jobsOf("action")).toEqual([]);
    expect(((await call("GET", "/queue/calls?failed=1")).json.calls as CallLog[])[0]!.entries.some((e) => !e.ok && e.error === "Answered 500")).toBe(true);
  });

  it("a request inside another (an assistant's tool, a saved change done again) is logged with the outer one", async () => {
    const t = (await db.insert(schema.emailThreads).values({ userId, gmailThreadId: "t1", subject: "Leave", lastMessageAt: new Date(), accountId: (await db.select().from(schema.gmailAccounts))[0]!.id }).returning())[0]!;
    const outer = newBudget(50);
    await withCalls(outer, async () => app.request(`/api/threads/${t.id}/content`, { headers: { cookie } }, base));
    expect(await logs()).toEqual([]); // nothing written by the inner request itself
    expect(outer.log.every((e) => e.inner === `GET /api/threads/${t.id}/content`)).toBe(true);
  });
});

describe("failed changes", () => {
  it("one that saved nothing is kept, the app is told, and a later run does it again", async () => {
    // A request that may make no calls at all: the label can't be made in Gmail.
    const r = await call("POST", "/labels", { name: "സാമ്പത്തിക വർഷം 2026-27 റീകൺസിലിയേഷൻ" }, { ...base, SUBREQUEST_LIMIT: "3" });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: "saved_for_retry" });
    const [job] = await jobsOf("action");
    expect(job).toMatchObject({ status: "queued", title: "Create label", id: r.json.jobId });
    expect(job!.payload).toMatchObject({ method: "POST", path: "/api/labels", from: "app" });
    const [row] = await logs();
    expect(row).toMatchObject({ ranOut: true, jobId: job!.id });
    expect(job!.callLogId).toBe(row!.id);

    // Due after its wait; then done again through the same route, as the user.
    await db.update(schema.jobs).set({ runAfter: new Date(0) }).where(eq(schema.jobs.id, job!.id));
    const run = await runQueue(db, base, userId, "app", []);
    expect(run.ran).toEqual([{ kind: "action", result: "done", note: "Done again successfully" }]);
    expect((await db.select().from(schema.gmailLabels)).map((l) => l.name)).toEqual(["സാമ്പത്തിക വർഷം 2026-27 റീകൺസിലിയേഷൻ"]);
  });

  it("one that had already saved part of itself waits for the user's check; Retry and Discard work", async () => {
    const entries: CallEntry[] = [
      { at: 0, ms: 3, kind: "db", what: "insert tasks", write: true, ok: true },
      { at: 4, ms: 3, kind: "gmail", what: "POST /threads/t1/modify", write: true, repeatable: true, ok: true },
      { at: 8, ms: 0, kind: "db", what: "insert events", write: true, ok: false, error: "Not made: this run's calls ran out" },
    ];
    const saved = await saveFailedChange(db, { userId, method: "POST", path: "/api/tasks", body: JSON.stringify({ title: "Staff meeting" }), from: "app", entries, error: "calls ran out" }, crypto.randomUUID());
    expect(saved).toMatchObject({ check: true, title: "Create task" });
    let [job] = await jobsOf("action");
    expect(job).toMatchObject({ status: "check" });
    expect(job!.note).toContain("insert tasks");
    expect(job!.note).not.toContain("modify"); // a Gmail label change is safe to do again
    // Not run on its own.
    expect((await runQueue(db, base, userId, "app", [])).ran).toEqual([]);

    const info = (await call("GET", "/queue")).json as QueueInfo;
    expect(info.jobs.find((j) => j.id === job!.id)).toMatchObject({ status: "check", request: "POST /api/tasks", title: "Create task" });
    expect(JSON.stringify(info)).not.toContain("Staff meeting"); // the saved body stays on the server

    const retried = await call("POST", `/queue/${job!.id}/retry`);
    expect(retried.json.ran).toEqual([{ kind: "action", result: "done", note: "Done again successfully" }]);
    expect((await db.select().from(schema.tasks)).map((t) => t.title)).toEqual(["Staff meeting"]);

    await saveFailedChange(db, { userId, method: "POST", path: "/api/tasks", body: "{}", from: "app", entries, error: "x" }, crypto.randomUUID());
    [job] = (await jobsOf("action")).filter((j) => j.status === "check");
    expect((await call("POST", `/queue/${job!.id}/discard`)).status).toBe(200);
    expect((await jobsOf("action")).filter((j) => j.status === "check")).toEqual([]);
    const history = (await db.select().from(schema.events)).map((e) => e.summary);
    expect(history).toContain("Discarded from the queue: Create task");
  });

  it("a change refused when done again (no longer valid) fails at once instead of trying five times", async () => {
    await saveFailedChange(db, { userId, method: "POST", path: "/api/tasks", body: JSON.stringify({ title: "" }), from: "app", entries: [], error: "x" }, crypto.randomUUID());
    await db.update(schema.jobs).set({ runAfter: new Date(0) });
    const r = await runQueue(db, base, userId, "app", []);
    expect(r.ran[0]).toMatchObject({ kind: "action", result: "failed" });
    expect((await jobsOf("action"))[0]!.note).toMatch(/^Refused when done again/);
  });
});

describe("refused phone notifications", () => {
  it("are saved, sent again by the queue, and dropped when too late", async () => {
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const p256dh = b64url(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer));
    await db.insert(schema.pushSubscriptions).values({ userId, endpoint: "https://web.push.apple.com/device-1", p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) });

    pushStatus = 500;
    expect(await pushToUser(db, base, userId, [{ title: "Staff meeting", body: "10:30", url: "/" }])).toBe(0);
    const [job] = await jobsOf("push");
    expect(job).toMatchObject({ status: "queued", title: "Notification: Staff meeting" });

    pushStatus = 201;
    await db.update(schema.jobs).set({ runAfter: new Date(0) });
    expect((await runQueue(db, base, userId, "app", [])).ran).toEqual([{ kind: "push", result: "done", note: "Sent: Staff meeting" }]);

    pushStatus = 500;
    await pushToUser(db, base, userId, [{ title: "Old note", body: "", url: "/" }]);
    const late = (await jobsOf("push")).find((j) => j.status === "queued")!;
    await db.update(schema.jobs).set({ runAfter: new Date(0), payload: { ...(late.payload as object), at: new Date(Date.now() - 3 * 3600_000).toISOString() } as never }).where(eq(schema.jobs.id, late.id));
    expect((await runQueue(db, base, userId, "app", [])).ran[0]!.note).toMatch(/hours late/);
  });
});

describe("keeping the log", () => {
  it("clears rows that worked after 2 days and failed ones after 30", async () => {
    const day = 86400_000;
    const row = (daysAgo: number, failed: number) => ({ id: crypto.randomUUID(), userId, source: "app" as const, request: `GET /x${daysAgo}-${failed}`, startedAt: new Date(Date.now() - daysAgo * day), failed });
    await db.insert(schema.callLogs).values([row(1, 0), row(3, 0), row(3, 1), row(31, 1)]);
    await runQueue(db, base, userId, "app", ["upkeep"]);
    expect((await logs()).map((r) => r.request).sort()).toEqual(["GET /x1-0", "GET /x3-1"]);
  });
});
