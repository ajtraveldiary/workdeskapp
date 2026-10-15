// Joining and relieving an employee (user request 2026-10-15): the task with its steps, the table, and the two
// kept in step both ways; relieving marks them Left on the date, joining brings them back.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Employee, StaffMove, Task } from "../src/shared/types";

describe("joining and relieving", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
  };
  const moves = async () => (await call("GET", "/moves")).json.moves as StaffMove[];
  const task = async (id: string) => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.id === id);
  const employee = async (id: string) => ((await call("GET", "/staff")).json.employees as Employee[]).find((e) => e.id === id)!;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("joining makes the task with its steps, and the table and the task stay in step", async () => {
    const id = (await call("POST", "/staff/employees", { name: "മഞ്ജിമ" })).json.id as string;
    const made = await call("POST", "/moves", { employeeId: id, kind: "join", date: "2026-10-01" });
    expect(made.status).toBe(201);
    const t = (await task(made.json.taskId))!;
    expect([t.title, t.dueDate, t.madeBySystem, t.systemKind, t.relatedKind, t.relatedId]).toEqual(["Joining: മഞ്ജിമ", "2026-10-08", true, "joining", "employee", id]);
    expect(t.checklist.map((i) => i.text)).toEqual(["Joining report", "Adding in SPARK", "Send letter to institution", "Service book received"]);
    expect((await employee(id)).joinedOfficeOn).toBe("2026-10-01");

    // Table → task.
    const m = (await moves())[0]!;
    await call("POST", `/moves/${m.id}/step`, { step: "joining-report", state: "done" });
    await call("POST", `/moves/${m.id}/step`, { step: "spark-add", state: "waiting" });
    expect((await moves())[0]!.steps.map((s) => s.state)).toEqual(["done", "waiting", "pending", "pending"]);
    const items = (await task(t.id))!.checklist;
    expect(items.map((i) => [i.done, !!i.waiting])).toEqual([[true, false], [false, true], [false, false], [false, false]]);

    // Task → table (ticking steps in the task), and all done completes it.
    await call("PATCH", `/tasks/${t.id}`, { checklist: items.map((i) => ({ ...i, done: true, waiting: false })) });
    expect((await task(t.id))!.status).toBe("done");
    expect((await moves())[0]!).toMatchObject({ finished: true, steps: [{ state: "done" }, { state: "done" }, { state: "done" }, { state: "done" }] });

    // A step set back reopens it.
    await call("POST", `/moves/${m.id}/step`, { step: "sb-received", state: "waiting" });
    expect((await task(t.id))!.status).toBe("open");
    expect((await moves())[0]!.finished).toBe(false);
  });

  it("relieving marks them Left on the date, only once; joining again brings them back; deleting the task drops the row", async () => {
    const id = (await call("POST", "/staff/employees", { name: "Anila" })).json.id as string;
    const r = await call("POST", "/moves", { employeeId: id, kind: "relieve", date: "2026-10-10" });
    expect((await employee(id)).leftOn).toBe("2026-10-10");
    expect((await task(r.json.taskId))!.checklist.map((i) => i.text)).toEqual(["Relieving order", "Relieve in SPARK", "Letter from institution", "Update service book", "Send LPC / service book"]);
    expect((await call("POST", "/moves", { employeeId: id, kind: "relieve", date: "2026-10-11" })).status).toBe(409);
    expect((await call("POST", `/moves/${(await moves())[0]!.id}/step`, { step: "nope", state: "done" })).status).toBe(400);

    await call("POST", "/moves", { employeeId: id, kind: "join", date: "2026-10-20" });
    expect((await employee(id)).leftOn).toBeNull();
    expect((await moves()).map((m) => m.kind)).toEqual(["join", "relieve"]);

    await call("POST", "/tasks/bulk-delete", { ids: [r.json.taskId] });
    expect((await moves()).map((m) => m.kind)).toEqual(["join"]);
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((h) => h.summary);
    expect(history).toContain("Anila relieved on 10 Oct 2026");
  });

  it("someone already working here can be put into joining with steps already done (Settings › Employees)", async () => {
    const id = (await call("POST", "/staff/employees", { name: "Shyna S", joinedOfficeOn: "2026-09-01" })).json.id as string;
    const r = await call("POST", "/moves", { employeeId: id, kind: "join", date: "2026-09-01", doneSteps: ["joining-report", "letter-sent"] });
    expect((await moves())[0]!.steps.map((s) => s.state)).toEqual(["done", "pending", "done", "pending"]);
    expect((await task(r.json.taskId))!.status).toBe("open");
    // Every step already done: the task is completed at once.
    const id2 = (await call("POST", "/staff/employees", { name: "All Done" })).json.id as string;
    const r2 = await call("POST", "/moves", { employeeId: id2, kind: "join", date: "2026-09-01", doneSteps: ["joining-report", "spark-add", "letter-sent", "sb-received"] });
    expect((await task(r2.json.taskId))!.status).toBe("done");
  });
});
