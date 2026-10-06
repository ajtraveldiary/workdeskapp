// Task / done labels (Settings > Mail), against a simulated Gmail and an in-memory database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { encryptSecret } from "../src/server/lib/crypto";
import { syncAccount, syncUser } from "../src/server/lib/sync";
import { importLabel, labelTaskEmails, reconcileThreadLabels } from "../src/server/lib/taskLabels";
import type { Env } from "../src/server/env";

const KEY = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const env: Env = { TOKEN_ENC_KEY: KEY, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };

const msg = (id: string, threadId: string, t: number, labels: string[]) => ({
  id,
  threadId,
  internalDate: String(t),
  labelIds: labels,
  snippet: `snippet ${id}`,
  payload: { headers: [{ name: "From", value: `S <${id}@example.gov>` }, { name: "Subject", value: `Subject ${threadId}` }] },
});

let mailbox: ReturnType<typeof msg>[];
const failModify = new Set<string>(); // threads whose next label change Gmail refuses
let modifies: { threadId: string; body: { addLabelIds: string[]; removeLabelIds: string[] } }[];

async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "tok" });
  const path = url.pathname.replace("/gmail/v1/users/me", "");
  const modify = path.match(/^\/threads\/([\w-]+)\/modify$/);
  if (modify && init?.method === "POST") {
    if (failModify.delete(modify[1]!)) return json({ error: "backend error" }, 500);
    const body = JSON.parse(String(init.body));
    modifies.push({ threadId: modify[1]!, body });
    for (const m of mailbox.filter((m) => m.threadId === modify[1])) m.labelIds = [...m.labelIds.filter((l) => !body.removeLabelIds.includes(l)), ...body.addLabelIds];
    return json({});
  }
  if (path === "/profile") return json({ emailAddress: "me@example.gov", historyId: "100" });
  if (path === "/labels") return json({ labels: [{ id: "Label_task", name: "WD/Task", type: "user" }, { id: "Label_done", name: "WD/Done", type: "user" }] });
  if (path === "/history") return json({ history: [], historyId: "200" });
  if (path === "/messages") {
    const label = url.searchParams.get("labelIds");
    const list = mailbox.filter((m) => (label ? m.labelIds.includes(label) : m.labelIds.includes("INBOX")));
    return json({ messages: list.map((m) => ({ id: m.id, threadId: m.threadId })) });
  }
  if (path.startsWith("/threads/")) {
    const id = path.split("/")[2];
    return json({ id, messages: mailbox.filter((m) => m.threadId === id) });
  }
  return json({ error: "unexpected " + path }, 500);
}

let db: DB;
let userId: string;
let accountId: string;
const account = async () => (await db.select().from(schema.gmailAccounts).where(eq(schema.gmailAccounts.id, accountId)))[0]!;
const threadByGmail = async (gid: string) => (await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.gmailThreadId, gid)))[0];
const tasksOf = async (threadUuid: string) => db.select().from(schema.tasks).where(eq(schema.tasks.threadId, threadUuid));
const choose = (taskLabelId: string | null, doneLabelId: string | null) =>
  db.update(schema.users).set({ taskLabelId, doneLabelId }).where(eq(schema.users.id, userId));

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as DB;
  const [user] = await db.insert(schema.users).values({ email: "me@example.gov" }).returning();
  userId = user!.id;
  const [acc] = await db
    .insert(schema.gmailAccounts)
    .values({ userId, email: "me@example.gov", refreshTokenEnc: await encryptSecret("refresh", KEY), grantedScopes: "https://www.googleapis.com/auth/gmail.modify" })
    .returning();
  accountId = acc!.id;
  modifies = [];
  failModify.clear();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => vi.unstubAllGlobals());

describe("task labels", () => {
  it("choosing the task label turns every email with it into a task, fetching ones WorkDesk didn't have", async () => {
    mailbox = [
      msg("m1", "t1", 1000, ["INBOX", "Label_task"]), // in WorkDesk already
      msg("m2", "t2", 2000, ["INBOX"]), // unrelated
      msg("m3", "t3", 3000, ["Label_task"]), // archived, not in WorkDesk yet
    ];
    await syncAccount(db, env, await account()); // first sync: inbox only (t1, t2)
    expect(await threadByGmail("t3")).toBeUndefined();

    await choose("Label_task", null);
    const r = await importLabel(db, env, userId, "Label_task");
    expect(r).toMatchObject({ created: 1, queued: 1 });
    const t1 = (await threadByGmail("t1"))!;
    expect(t1.state).toBe("task");
    expect((await tasksOf(t1.id)).map((t) => t.status)).toEqual(["open"]);
    expect((await threadByGmail("t2"))!.state).toBe("needs_decision");

    // The queued archived email arrives on the next sync and becomes a task too.
    await syncAccount(db, env, await account());
    const t3 = (await threadByGmail("t3"))!;
    expect(t3.state).toBe("task");
    expect((await tasksOf(t3.id)).map((t) => t.status)).toEqual(["open"]);
  });

  it("choosing the done label completes those emails' tasks (or creates completed ones) and tidies the labels", async () => {
    mailbox = [msg("m1", "t1", 1000, ["INBOX", "Label_task", "Label_done"]), msg("m2", "t2", 2000, ["INBOX", "Label_done"])];
    await syncAccount(db, env, await account());
    await choose("Label_task", null);
    await importLabel(db, env, userId, "Label_task"); // t1 gets an open task
    modifies = [];

    await choose("Label_task", "Label_done");
    const r = await importLabel(db, env, userId, "Label_done");
    expect(r).toMatchObject({ created: 1, completed: 1 });
    const t1 = (await threadByGmail("t1"))!;
    const t2 = (await threadByGmail("t2"))!;
    expect((await tasksOf(t1.id)).map((t) => t.status)).toEqual(["done"]);
    expect((await tasksOf(t2.id)).map((t) => t.status)).toEqual(["done"]);
    // t1 still had the task label in Gmail; completing it removes that.
    expect(modifies).toEqual([{ threadId: "t1", body: { addLabelIds: [], removeLabelIds: ["Label_task"] } }]);
  });

  it("creating, completing and reopening a task swaps the labels in Gmail", async () => {
    mailbox = [msg("m1", "t1", 1000, ["INBOX"])];
    await syncAccount(db, env, await account());
    await choose("Label_task", "Label_done");
    const t1 = (await threadByGmail("t1"))!;
    const [task] = await db.insert(schema.tasks).values({ userId, title: "Do it", threadId: t1.id }).returning();

    await reconcileThreadLabels(db, env, userId, [t1.id]); // task created
    await db.update(schema.tasks).set({ status: "done" }).where(eq(schema.tasks.id, task!.id));
    await reconcileThreadLabels(db, env, userId, [t1.id]); // completed
    await db.update(schema.tasks).set({ status: "open" }).where(eq(schema.tasks.id, task!.id));
    await reconcileThreadLabels(db, env, userId, [t1.id]); // reopened

    expect(modifies.map((m) => m.body)).toEqual([
      { addLabelIds: ["Label_task"], removeLabelIds: [] },
      { addLabelIds: ["Label_done"], removeLabelIds: ["Label_task"] },
      { addLabelIds: ["Label_task"], removeLabelIds: ["Label_done"] },
    ]);
    expect((await threadByGmail("t1"))!.labelIds).toEqual(["Label_task"]);
  });

  it("emails that were already tasks get labelled once labels are chosen, and a failed one is retried by the next sync", async () => {
    mailbox = [msg("m1", "t1", 1000, ["INBOX"]), msg("m2", "t2", 2000, ["INBOX"]), msg("m3", "t3", 3000, ["INBOX"])];
    await syncAccount(db, env, await account());
    const [t1, t2] = [(await threadByGmail("t1"))!, (await threadByGmail("t2"))!];
    // Tasks made before any label was chosen: t1 open, t2 completed; t3 is not a task.
    await db.insert(schema.tasks).values([
      { userId, title: "Open one", threadId: t1.id },
      { userId, title: "Done one", threadId: t2.id, status: "done", completedAt: new Date() },
    ]);
    await choose("Label_task", "Label_done");

    failModify.add("t2");
    expect(await labelTaskEmails(db, env, userId)).toEqual({ labelled: 1, remaining: 0 });
    expect(modifies.map((m) => [m.threadId, m.body.addLabelIds])).toEqual([["t1", ["Label_task"]]]);

    await syncUser(db, env, userId); // the next sync picks up the one Gmail refused
    expect(modifies.map((m) => [m.threadId, m.body.addLabelIds])).toEqual([["t1", ["Label_task"]], ["t2", ["Label_done"]]]);
    expect(mailbox.find((m) => m.threadId === "t3")!.labelIds).toEqual(["INBOX"]);
    expect(await labelTaskEmails(db, env, userId)).toEqual({ labelled: 0, remaining: 0 }); // nothing left to do
  });
});
