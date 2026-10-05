// Sync against a simulated Gmail and an in-memory database: checks that each message is downloaded once,
// that read/unread changes need no download, and that the 30-day backfill continues across runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { encryptSecret } from "../src/server/lib/crypto";
import { syncAccount } from "../src/server/lib/sync";
import type { Env } from "../src/server/env";

const KEY = Buffer.from(new Uint8Array(32).fill(3)).toString("base64");
const env: Env = { TOKEN_ENC_KEY: KEY, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };

type Msg = { id: string; threadId: string; internalDate: string; labelIds: string[]; snippet: string; payload: { headers: { name: string; value: string }[] } };
const msg = (id: string, threadId: string, t: number, labels = ["INBOX"], subject = "Statement"): Msg => ({
  id,
  threadId,
  internalDate: String(t),
  labelIds: labels,
  snippet: `snippet ${id}`,
  payload: { headers: [{ name: "From", value: `Sender ${id} <${id}@example.gov>` }, { name: "Subject", value: subject }] },
});

// Simulated Gmail state and a log of every Gmail API path requested.
let mailbox: Msg[];
let listPages: { id: string; threadId: string }[][];
let history: unknown[];
let calls: string[];
let gmailLabelList: { id: string; name: string; type: string }[];
let labelMembers: Record<string, { id: string; threadId: string }[]>;

function fakeFetch(input: string | URL | Request) {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "tok" });
  const path = url.pathname.replace("/gmail/v1/users/me", "");
  calls.push(path);
  if (path === "/profile") return json({ emailAddress: "me@example.gov", historyId: "100" });
  if (path === "/messages") {
    const labelId = url.searchParams.get("labelIds");
    if (labelId) return json({ messages: labelMembers[labelId] ?? [] });
    const page = Number(url.searchParams.get("pageToken") ?? 0);
    return json({ messages: listPages[page], nextPageToken: page + 1 < listPages.length ? String(page + 1) : undefined });
  }
  if (path.startsWith("/threads/")) {
    const id = path.split("/")[2];
    return json({ id, messages: mailbox.filter((m) => m.threadId === id) });
  }
  if (path.startsWith("/messages/")) {
    const m = mailbox.find((x) => x.id === path.split("/")[2]);
    return m ? json(m) : json({ error: "not found" }, 404);
  }
  if (path === "/history") return json({ history, historyId: "200" });
  if (path === "/labels") return json({ labels: gmailLabelList });
  return json({ error: "unexpected" }, 500);
}

let db: DB;
let accountId: string;
const account = async () => (await db.select().from(schema.gmailAccounts).where(eq(schema.gmailAccounts.id, accountId)))[0]!;
const threads = async () =>
  Object.fromEntries((await db.select().from(schema.emailThreads)).map((t) => [t.gmailThreadId, t]));

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as DB;
  const [user] = await db.insert(schema.users).values({ email: "me@example.gov" }).returning();
  const [acc] = await db
    .insert(schema.gmailAccounts)
    .values({ userId: user!.id, email: "me@example.gov", refreshTokenEnc: await encryptSecret("refresh", KEY) })
    .returning();
  accountId = acc!.id;
  calls = [];
  history = [];
  gmailLabelList = [];
  labelMembers = {};
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => vi.unstubAllGlobals());

describe("Gmail sync", () => {
  it("downloads each conversation once on the first sync", async () => {
    mailbox = [msg("m1", "t1", 1000), msg("m2", "t1", 2000, ["INBOX", "UNREAD"]), msg("m3", "t2", 3000)];
    listPages = [[{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t1" }, { id: "m3", threadId: "t2" }]];

    const r = await syncAccount(db, env, await account());
    expect(r).toEqual({ fetched: 2, remaining: 0 });
    expect(calls).toEqual(["/profile", "/messages", "/labels", "/threads/t1", "/threads/t2"]);
    const t = await threads();
    expect(t.t1).toMatchObject({ messageCount: 2, unread: true });
    expect(await db.select().from(schema.gmailMessages)).toHaveLength(3);
  });

  it("afterwards fetches only new messages, and applies read/unread without downloading", async () => {
    mailbox = [msg("m1", "t1", 1000), msg("m2", "t1", 2000), msg("m3", "t2", 3000, ["INBOX", "UNREAD"])];
    listPages = [[{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t1" }, { id: "m3", threadId: "t2" }]];
    await syncAccount(db, env, await account());
    calls = [];

    mailbox.push(msg("m4", "t1", 4000, ["INBOX", "UNREAD"]));
    history = [
      { messagesAdded: [{ message: { id: "m4", threadId: "t1" } }] },
      { messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] }, // already downloaded: skipped
      { labelsRemoved: [{ message: { id: "m3", threadId: "t2" }, labelIds: ["UNREAD"] }] }, // read in Gmail
    ];
    const r = await syncAccount(db, env, await account());
    expect(r).toEqual({ fetched: 1, remaining: 0 });
    expect(calls).toEqual(["/history", "/messages/m4"]);
    const t = await threads();
    expect(t.t1).toMatchObject({ messageCount: 3, unread: true, snippet: "snippet m4", fromName: "Sender m4" });
    expect(t.t2).toMatchObject({ unread: false });

    // Nothing new: only the change log is read.
    calls = [];
    history = [];
    await syncAccount(db, env, await account());
    expect(calls).toEqual(["/history"]);
  });

  it("continues the 30-day backfill across runs", async () => {
    mailbox = Array.from({ length: 7 }, (_, i) => msg(`m${i}`, `t${i}`, 1000 + i));
    // 7 listing pages: 5 are read on the first run, the other 2 on the next.
    listPages = mailbox.map((m) => [{ id: m.id, threadId: m.threadId }]);

    const first = await syncAccount(db, env, await account());
    expect(calls.filter((c) => c === "/messages")).toHaveLength(5);
    expect(first.remaining).toBeGreaterThan(0);
    expect((await account()).initialPageToken).toBe("5");

    calls = [];
    const second = await syncAccount(db, env, await account());
    expect(calls).toEqual(["/messages", "/messages", "/history", "/threads/t5", "/threads/t6"]);
    expect(second.remaining).toBe(0);
    expect(Object.keys(await threads())).toHaveLength(7);
  });

  it("keeps the user's own labels: from downloads, from the change log, and once for older conversations", async () => {
    gmailLabelList = [
      { id: "Label_1", name: "Accounts", type: "user" },
      { id: "Label_2", name: "Urgent", type: "user" },
      { id: "INBOX", name: "INBOX", type: "system" },
    ];
    mailbox = [msg("m1", "t1", 1000, ["INBOX", "Label_1"]), msg("m2", "t2", 2000)];
    listPages = [[{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }]];
    await syncAccount(db, env, await account());
    expect((await threads()).t1!.labelIds).toEqual(["Label_1"]); // system labels aren't kept
    expect((await db.select().from(schema.gmailLabels)).map((l) => l.name).sort()).toEqual(["Accounts", "Urgent"]);

    // Labels changed in Gmail arrive through the change log; nothing is downloaded.
    calls = [];
    history = [
      { labelsAdded: [{ message: { id: "m2", threadId: "t2" }, labelIds: ["Label_2"] }] },
      { labelsRemoved: [{ message: { id: "m1", threadId: "t1" }, labelIds: ["Label_1"] }] },
    ];
    await syncAccount(db, env, await account());
    expect(calls).toEqual(["/history"]);
    const t = await threads();
    expect(t.t1!.labelIds).toEqual([]);
    expect(t.t2!.labelIds).toEqual(["Label_2"]);
  });

  it("backfills labels once for conversations stored before labels were tracked", async () => {
    mailbox = [msg("m1", "t1", 1000)];
    listPages = [[{ id: "m1", threadId: "t1" }]];
    await syncAccount(db, env, await account());
    // Pretend this account predates labels: no backfill done yet, label list due a refresh.
    await db.update(schema.gmailAccounts).set({ labelsBackfilledAt: null, labelsSyncedAt: null }).where(eq(schema.gmailAccounts.id, accountId));
    gmailLabelList = [{ id: "Label_7", name: "HMIS", type: "user" }];
    labelMembers = { Label_7: [{ id: "m1", threadId: "t1" }] };
    calls = [];
    history = [];
    await syncAccount(db, env, await account());
    expect(calls).toEqual(["/history", "/labels", "/messages"]); // one listing per label, no downloads
    expect((await threads()).t1!.labelIds).toEqual(["Label_7"]);
    expect((await account()).labelsBackfilledAt).not.toBeNull();
  });
});
