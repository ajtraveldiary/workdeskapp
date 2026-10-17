// More emails on a task or an event (user request 2026-10-17): added from Pending, they behave like the main email
// (leave Pending, a new reply flags the task, the task's state shows on them), can be taken off (back to Pending),
// and go back to Pending when the task or event is deleted.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { applySnapshots } from "../src/server/lib/sync";
import type { LinkedEmail, Thread } from "../src/shared/types";

describe("more emails on a task or event", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
  };
  const all = async () => (await call("GET", "/threads?state=all")).json.threads as Thread[];
  const thread = async (id: string) => (await all()).find((t) => t.id === id)!;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("added to a task: out of Pending, listed, a new reply flags them, taken off or deleted they come back", async () => {
    const pending = (await call("GET", "/threads?state=needs_decision")).json.threads as Thread[];
    const [a, b, c] = pending as [Thread, Thread, Thread];
    const task = (await call("POST", `/threads/${a.id}/task`, { title: "Reply to the circular" })).json;
    const res = await call("POST", "/linked-emails", { taskId: task.id, threadIds: [b.id, c.id] });
    expect(res.json).toMatchObject({ added: 2, skipped: 0 });
    expect([(await thread(b.id)).state, (await thread(c.id)).state]).toEqual(["task", "task"]);
    expect((await thread(b.id)).task).toMatchObject({ open: 1 });
    const list = (await call("GET", `/linked-emails?taskId=${task.id}`)).json.emails as LinkedEmail[];
    expect(list[0]).toMatchObject({ id: a.id, main: true });
    expect(new Set(list.filter((e) => !e.main).map((e) => e.id))).toEqual(new Set([b.id, c.id]));
    // Already taken: not again.
    expect((await call("POST", "/linked-emails", { taskId: task.id, threadIds: [b.id] })).status).toBe(409);

    // A new reply on an added email keeps it with the open task, flagged.
    const [row] = await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.id, b.id));
    await applySnapshots(db, row!.userId, null, [{ gmailThreadId: row!.gmailThreadId, subject: row!.subject, fromName: row!.fromName, fromEmail: row!.fromEmail, snippet: "New reply", lastMessageAt: new Date(row!.lastMessageAt.getTime() + 60_000), messageCount: row!.messageCount + 1, unread: true, inInbox: true }]);
    expect((await thread(b.id))).toMatchObject({ state: "task", hasNewActivity: true });

    // Completing the task shows on its added emails.
    await call("POST", `/tasks/${task.id}/complete`);
    expect((await thread(c.id)).task).toMatchObject({ open: 0, done: 1 });

    // Taken off: back to Pending.
    await call("DELETE", `/linked-emails/${c.id}?taskId=${task.id}`);
    expect((await thread(c.id)).state).toBe("needs_decision");
    expect((await call("DELETE", `/linked-emails/${a.id}?taskId=${task.id}`)).status).toBe(400);

    // Deleting the task: its main and added emails go back to Pending.
    await call("POST", "/tasks/bulk-delete", { ids: [task.id] });
    expect([(await thread(a.id)).state, (await thread(b.id)).state]).toEqual(["needs_decision", "needs_decision"]);
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((h) => h.summary);
    expect(history).toContain("Added to task: Reply to the circular");
  });

  it("added to an event: tagged Event, back to Pending when taken off or the event is deleted", async () => {
    const [a, b] = (await call("GET", "/threads?state=needs_decision")).json.threads as [Thread, Thread];
    const ev = (await call("POST", "/office-events", { title: "District review meeting", startDate: "2026-11-05" })).json;
    await call("POST", "/linked-emails", { eventId: ev.id, threadIds: [a.id, b.id] });
    expect([(await thread(a.id)).state, (await thread(b.id)).state]).toEqual(["event", "event"]);
    await call("DELETE", `/linked-emails/${a.id}?eventId=${ev.id}`);
    expect((await thread(a.id)).state).toBe("needs_decision");
    await call("DELETE", `/office-events/${ev.id}`);
    expect((await thread(b.id)).state).toBe("needs_decision");
  });

  it("taken off an email whose own earlier task is done: back to Pending", async () => {
    const [a, b] = (await call("GET", "/threads?state=needs_decision")).json.threads as [Thread, Thread];
    const old = (await call("POST", `/threads/${b.id}/task`, { title: "Old work" })).json;
    await call("POST", `/tasks/${old.id}/complete`);
    await db.update(schema.emailThreads).set({ state: "needs_decision" }).where(eq(schema.emailThreads.id, b.id)); // a new reply came
    const task = (await call("POST", `/threads/${a.id}/task`, { title: "New work" })).json;
    await call("POST", "/linked-emails", { taskId: task.id, threadIds: [b.id] });
    expect((await thread(b.id)).state).toBe("task");
    await call("DELETE", `/linked-emails/${b.id}?taskId=${task.id}`);
    expect((await thread(b.id)).state).toBe("needs_decision");
  });
});
