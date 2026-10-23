// Background queue (user request 2026-10-23, "a queue system so that no service gets lost, and let the user view
// it"): every kind of background work is a job; a run that runs out of calls leaves work queued instead of losing
// it, failures are tried again and then kept as failed, and Settings › Queue lists them with Run now and Retry.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import type { Env } from "../src/server/env";
import { encryptSecret } from "../src/server/lib/crypto";
import { b64url } from "../src/server/lib/webpush";
import { OutOfCalls, installCallCounter, isOutOfCalls, newBudget, spare, withCalls } from "../src/server/lib/callBudget";
import { runQueue } from "../src/server/lib/queue";
import { createApp } from "../src/server/app";
import type { QueueInfo, QueueRunReport } from "../src/shared/types";

const KEY = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const env: Env = { TOKEN_ENC_KEY: KEY, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", APP_TIMEZONE: "Asia/Kolkata" };

// A simulated Gmail and push service. The counter wraps this fetch once for the whole file.
let tokenFails = false;
let pushes = 0;
const thread = (id: string, t: number) => ({
  id,
  messages: [{ id: `m-${id}`, threadId: id, internalDate: String(t), labelIds: ["INBOX"], snippet: "", payload: { headers: [{ name: "From", value: "DMO <dmo@example.gov>" }, { name: "Subject", value: `Letter ${id}` }] } }],
});
let mailbox = ["t1", "t2"];
async function fakeFetch(input: string | URL | Request) {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.hostname === "oauth2.googleapis.com") return tokenFails ? json({ error: "invalid_grant" }, 400) : json({ access_token: "tok" });
  if (url.hostname === "web.push.apple.com") {
    pushes++;
    return new Response(null, { status: 201 });
  }
  const path = url.pathname.replace("/gmail/v1/users/me", "");
  if (path === "/profile") return json({ historyId: "100" });
  if (path === "/messages") return json({ messages: mailbox.map((t) => ({ id: `m-${t}`, threadId: t })) });
  if (path.startsWith("/threads/")) return json(thread(path.split("/")[2]!, 1000));
  if (path === "/labels") return json({ labels: [] });
  if (path === "/history") return json({ history: [], historyId: "200" });
  return json({ error: "unexpected" }, 500);
}

let db: DB;
let userId: string;
const jobsNow = async () => db.select().from(schema.jobs).where(eq(schema.jobs.userId, userId));
const byKind = async (kind: string) => (await jobsNow()).filter((j) => j.kind === kind);

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  installCallCounter();
});

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as DB;
  userId = (await db.insert(schema.users).values({ email: "clerk@example.gov" }).returning())[0]!.id;
  await db.insert(schema.gmailAccounts).values({ userId, email: "clerk@example.gov", refreshTokenEnc: await encryptSecret("refresh", KEY) });
  tokenFails = false;
  pushes = 0;
  mailbox = ["t1", "t2"];
});

afterEach(() => vi.useRealTimers());

describe("calls budget", () => {
  it("refuses calls past the limit but keeps the reserve for the queue's own writes", async () => {
    await withCalls(newBudget(5, 2), async () => {
      for (let i = 0; i < 3; i++) await fetch("https://oauth2.googleapis.com/token");
      const refused = await fetch("https://oauth2.googleapis.com/token").catch((e) => e);
      expect(refused).toBeInstanceOf(OutOfCalls);
      await spare(async () => {
        await fetch("https://oauth2.googleapis.com/token");
        await fetch("https://oauth2.googleapis.com/token");
      });
      expect(await fetch("https://oauth2.googleapis.com/token").catch((e) => e)).toBeInstanceOf(OutOfCalls);
    });
    // Outside a budget nothing is counted.
    expect((await fetch("https://oauth2.googleapis.com/token")).ok).toBe(true);
  });

  it("recognises a refused call however the database driver wraps it", () => {
    const neon = Object.assign(new Error("Error connecting to database: OutOfCalls"), { sourceError: new OutOfCalls() });
    expect(isOutOfCalls(new Error("query failed", { cause: neon }))).toBe(true);
    expect(isOutOfCalls(new Error("Too many subrequests by single Worker invocation."))).toBe(true);
    expect(isOutOfCalls(new Error("invalid_grant"))).toBe(false);
  });
});

describe("background queue", () => {
  it("runs every kind of work in order and keeps one record of each", async () => {
    const r = await runQueue(db, env, userId, "schedule");
    expect(r.ran.map((x) => [x.kind, x.result])).toEqual([
      ["notify", "done"],
      ["sync", "done"],
      ["labels", "done"],
      ["upkeep", "done"],
    ]);
    expect(r.fetched).toBe(2);
    expect((await byKind("sync"))[0]).toMatchObject({ status: "done", note: "Downloaded 2 emails", ranBy: "schedule" });
    expect(await db.select().from(schema.emailThreads)).toHaveLength(2);
  });

  it("leaves work queued when a run has too few calls, never more than one waiting job per kind", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await withCalls(newBudget(6), () => runQueue(db, env, userId, "schedule"));
      expect(r.ran).toEqual([]);
      expect(r.more).toBe(true);
    }
    const waiting = await jobsNow();
    expect(waiting.map((j) => [j.kind, j.status]).sort()).toEqual([
      ["labels", "queued"],
      ["notify", "queued"],
      ["sync", "queued"],
      ["upkeep", "queued"],
    ]);
    // A later run with room takes them all.
    await runQueue(db, env, userId, "schedule");
    expect((await jobsNow()).every((j) => j.status === "done")).toBe(true);
    expect(await db.select().from(schema.emailThreads)).toHaveLength(2);
  });

  it("a sync downloads only what fits in the calls left and carries on in the next run", async () => {
    mailbox = Array.from({ length: 8 }, (_, i) => `t${i}`);
    // 3 kept back, 3 for the sign-in, profile, list and labels, 20 for saving: room for 4 downloads.
    const first = await withCalls(newBudget(3 + 4 + 20 + 4), () => runQueue(db, env, userId, "app", ["sync"]));
    expect(first.ran[0]).toMatchObject({ kind: "sync", result: "done" });
    expect(first.more).toBe(true);
    const stored = (await db.select().from(schema.emailThreads)).length;
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(8);
    await runQueue(db, env, userId, "app", ["sync"]);
    expect(await db.select().from(schema.emailThreads)).toHaveLength(8);
  });

  it("a notification that can't be sent within the run is kept, not marked sent, and goes out next run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T05:05:00Z")); // 10:35 in Kolkata
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const p256dh = b64url(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer));
    await db.insert(schema.pushSubscriptions).values({ userId, endpoint: "https://web.push.apple.com/device-1", p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) });
    const [t] = await db.insert(schema.tasks).values({ userId, title: "ജില്ലാ മെഡിക്കൽ ഓഫീസർക്ക് റിപ്പോർട്ട് സമർപ്പിക്കുക", dueDate: "2026-10-08", dueTime: "10:30" }).returning();

    const r = await withCalls(newBudget(10), () => runQueue(db, env, userId, "schedule", ["notify"]));
    expect(r.ran[0]).toMatchObject({ kind: "notify", result: "paused" });
    expect(pushes).toBe(0);
    expect((await db.select().from(schema.tasks).where(eq(schema.tasks.id, t!.id)))[0]!.pushNotifiedFor).toBeNull();
    expect((await byKind("notify"))[0]).toMatchObject({ status: "queued", pauses: 1 });

    const next = await runQueue(db, env, userId, "schedule", ["notify"]);
    expect(next.ran[0]).toMatchObject({ kind: "notify", result: "done" });
    expect(pushes).toBeGreaterThan(0);
    expect((await byKind("notify"))[0]).toMatchObject({ status: "done", pauses: 0 });
  });

  it("a failing sync is tried again later, then kept as failed; a new sync still runs", async () => {
    tokenFails = true;
    const r = await runQueue(db, env, userId, "schedule", ["sync"]);
    expect(r.ran[0]).toMatchObject({ kind: "sync", result: "retry" });
    let [job] = await byKind("sync");
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect((await db.select().from(schema.gmailAccounts))[0]!.lastSyncError).toBeTruthy();

    // Not tried again before its time.
    expect((await runQueue(db, env, userId, "schedule", ["sync"])).ran).toEqual([]);
    for (let i = 0; i < 4; i++) {
      await db.update(schema.jobs).set({ runAfter: new Date(0) }).where(eq(schema.jobs.id, job!.id));
      await runQueue(db, env, userId, "schedule", ["sync"]);
    }
    [job] = await byKind("sync");
    expect(job).toMatchObject({ status: "failed", attempts: 5 });

    // The failed one stays for Settings; the next run starts a fresh sync, which works once Gmail does.
    tokenFails = false;
    const after = await runQueue(db, env, userId, "schedule", ["sync"]);
    expect(after.ran[0]).toMatchObject({ kind: "sync", result: "done" });
    expect((await byKind("sync")).map((j) => j.status).sort()).toEqual(["done", "failed"]);
  });

  it("a job left running by a cut-off run is queued again", async () => {
    await db.insert(schema.jobs).values({ userId, kind: "sync", status: "running", startedAt: new Date(Date.now() - 10 * 60_000) });
    const r = await runQueue(db, env, userId, "schedule", ["sync"]);
    expect(r.ran[0]).toMatchObject({ kind: "sync", result: "done" });
    expect(await byKind("sync")).toHaveLength(1);
  });
});

describe("Settings › Queue", () => {
  it("lists the jobs, runs now, and retries a failed one", async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    const app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
    const call = async <T,>(method: string, path: string) => (await (await app.request(`/api${path}`, { method }, { SUBREQUEST_LIMIT: "50" })).json()) as T;

    const run = await call<QueueRunReport>("POST", "/queue/run");
    expect(run.ran.map((r) => r.kind)).toEqual(["notify", "sync", "labels", "upkeep"]);
    expect(run.ran.find((r) => r.kind === "sync")!.note).toBe("No Gmail account connected");

    const info = await call<QueueInfo>("GET", "/queue");
    expect(info.limit).toBe(50);
    expect(info.jobs).toHaveLength(4);

    const demoDb = d as unknown as DB;
    const [demoUser] = await demoDb.select().from(schema.users);
    const [failed] = await demoDb
      .insert(schema.jobs)
      .values({ userId: demoUser!.id, kind: "labels", status: "failed", attempts: 5, note: "Gmail refused", finishedAt: new Date() })
      .returning();
    const retried = await call<QueueRunReport>("POST", `/queue/${failed!.id}/retry`);
    expect(retried.ran.map((r) => [r.kind, r.result])).toEqual([["labels", "done"]]);
    expect((await call<QueueInfo>("GET", "/queue")).jobs.some((j) => j.status === "failed")).toBe(false);
  });
});
