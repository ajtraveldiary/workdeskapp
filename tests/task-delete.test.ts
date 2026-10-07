// Deleting tasks from the To-do card (user request 2026-10-07): only WorkDesk changes, History records it,
// reminder tasks are skipped and an email left without a task goes back to Pending.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Task, Thread } from "../src/shared/types";

describe("deleting tasks", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const allTasks = async () => (await call("GET", "/tasks?view=any")).json.tasks as Task[];
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("deletes hand-made and email tasks, skips reminder tasks, returns the email to Pending", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const manual = (await call("POST", "/tasks", { title: "ജില്ലാ മെഡിക്കൽ ഓഫീസിലേക്ക് റിപ്പോർട്ട് അയയ്ക്കുക" })).json.id as string;
    const thread = ((await call("GET", "/threads?state=needs_decision")).json.threads as Thread[])[0]!;
    const fromEmail = (await call("POST", `/threads/${thread.id}/task`, { title: "Reply to DMO" })).json.id as string;
    const rid = (await call("POST", "/reports", { name: "HMIS", startDate: today })).json.id as string;
    const reminderTask = (await allTasks()).find((t) => t.report?.reportId === rid)!.id;

    const res = await call("POST", "/tasks/bulk-delete", { ids: [manual, fromEmail, reminderTask] });
    expect(res.json).toEqual({ deleted: 2, skipped: 1 });
    const left = (await allTasks()).map((t) => t.id);
    expect(left).not.toContain(manual);
    expect(left).not.toContain(fromEmail);
    expect(left).toContain(reminderTask);

    const pending = ((await call("GET", "/threads?state=needs_decision")).json.threads as Thread[]).map((t) => t.id);
    expect(pending).toContain(thread.id);
    const history = JSON.stringify((await call("GET", "/history")).json);
    expect(history).toContain("task.deleted");
    expect(history).toContain("email.returned");
  });
});
