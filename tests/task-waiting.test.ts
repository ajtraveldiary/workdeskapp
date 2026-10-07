// Waiting for a reply (user request 2026-10-07): waiting tasks leave the to-do views for "waiting", come back
// to Today / Overdue by the day a reply is expected, and a completed task can be put back to waiting.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { addDays } from "../src/client/format";
import type { Task } from "../src/shared/types";

describe("waiting for a reply", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const ids = async (view: string) => ((await call("GET", `/tasks?view=${view}`)).json.tasks as Task[]).map((t) => t.id);
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("moves a task to Waiting and back by the reply date", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const title = "സേവന പുസ്തകം പുതിയ സ്ഥാപനത്തിലേക്ക് അയച്ചതിന്റെ മറുപടി കാത്തിരിക്കുന്നു";
    const id = (await call("POST", "/tasks", { title, dueDate: addDays(today, -1) })).json.id as string;
    expect(await ids("overdue")).toContain(id);
    const waitingBefore = (await call("GET", "/summary")).json.counts.waiting as number;

    await call("PATCH", `/tasks/${id}`, { waiting: true, replyBy: addDays(today, 3) });
    expect(await ids("all")).not.toContain(id);
    expect(await ids("overdue")).not.toContain(id);
    expect(await ids("waiting")).toContain(id);
    expect((await call("GET", "/summary")).json.counts.waiting).toBe(waitingBefore + 1);

    // The reply day comes: back on Today; late: Overdue.
    await call("PATCH", `/tasks/${id}`, { replyBy: today });
    expect(await ids("today")).toContain(id);
    await call("PATCH", `/tasks/${id}`, { replyBy: addDays(today, -2) });
    expect(await ids("overdue")).toContain(id);
    expect(await ids("waiting")).toContain(id);

    // Back to to-do.
    await call("PATCH", `/tasks/${id}`, { waiting: false });
    const back = ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.id === id)!;
    expect(back.waitingSince).toBeNull();
    expect(back.replyBy).toBeNull();
    expect(await ids("all")).toContain(id);

    const history = (await call("GET", "/history")).json;
    const actions = JSON.stringify(history);
    expect(actions).toContain("task.waiting");
    expect(actions).toContain("task.waiting_ended");
  });

  it("puts a completed task back to waiting, and completing ends the wait", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const id = (await call("POST", "/tasks", { title: "Relieving order", waiting: true })).json.id as string;
    expect(await ids("waiting")).toContain(id);
    await call("POST", `/tasks/${id}/complete`);
    let t = ((await call("GET", "/tasks?view=completed")).json.tasks as Task[]).find((x) => x.id === id)!;
    expect(t.waitingSince).toBeNull();

    await call("PATCH", `/tasks/${id}`, { waiting: true, replyBy: addDays(today, 7) });
    t = ((await call("GET", "/tasks?view=waiting")).json.tasks as Task[]).find((x) => x.id === id)!;
    expect(t.status).toBe("open");
    expect(t.completedAt).toBeNull();
    expect(t.replyBy).toBe(addDays(today, 7));
  });

  it("doesn't let a reminder's task wait", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const rid = (await call("POST", "/reports", { name: "HMIS", startDate: today })).json.id as string;
    const task = ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.report?.reportId === rid)!;
    expect((await call("PATCH", `/tasks/${task.id}`, { waiting: true })).status).toBe(400);
  });
});
