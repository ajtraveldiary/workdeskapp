// A new message in a conversation whose task was completed brings it back to Pending, and the email says when it
// was done ("Already done on …", user request 2026-10-13): the server sends the completion time with the task info.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { onThreadUpdate } from "../src/server/lib/threadRules";
import type { Thread } from "../src/shared/types";

describe("already done", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
  };

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("an email back in Pending after its task was done carries when it was done", async () => {
    const thread = ((await call("GET", "/threads?state=needs_decision")).json.threads as Thread[])[0]!;
    const task = (await call("POST", `/threads/${thread.id}/task`, { title: "Reply to it" })).json;
    const before = Date.now();
    await call("POST", `/tasks/${task.id}/complete`);

    // A new message arrives (what the sync does with onThreadUpdate).
    const [row] = await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.id, thread.id));
    const later = new Date(row!.lastMessageAt.getTime() + 60_000);
    const d = onThreadUpdate({ state: row!.state, lastMessageAt: row!.lastMessageAt, hasNewActivity: row!.hasNewActivity }, later, 0);
    expect(d.state).toBe("needs_decision");
    await db.update(schema.emailThreads).set({ state: d.state, lastMessageAt: later }).where(eq(schema.emailThreads.id, thread.id));

    const back = ((await call("GET", "/threads?state=needs_decision")).json.threads as Thread[]).find((t) => t.id === thread.id)!;
    expect([back.task?.open, back.task?.done]).toEqual([0, 1]);
    expect(new Date(back.task!.doneAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // An email whose task is still open has no done time yet.
    const other = ((await call("GET", "/threads?state=needs_decision")).json.threads as Thread[]).find((t) => t.id !== thread.id)!;
    const open = (await call("POST", `/threads/${other.id}/task`, { title: "Still open" })).json;
    expect(open.id).toBeTruthy();
    const withOpen = ((await call("GET", "/threads?state=task")).json.threads as Thread[]).find((t) => t.id === other.id)!;
    expect([withOpen.task?.open, withOpen.task?.doneAt]).toEqual([1, null]);
  });
});
