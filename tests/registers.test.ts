// Registers (user request 2026-10-16): registers from Settings, pending entries with the employee who has to sign or
// give information, a task only when an entry has a due date, entry and task kept in step both ways, done entries
// kept, and the date a register is updated until.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Register, RegisterEntry, Task } from "../src/shared/types";

describe("registers", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
  };
  const registers = async () => (await call("GET", "/registers")).json.registers as Register[];
  const entries = async () => (await call("GET", "/register-entries")).json.entries as RegisterEntry[];
  const task = async (id: string) => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.id === id);

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("are added in Settings: rename, arrange, updated until, delete", async () => {
    const sb = (await call("POST", "/registers", { name: "Service book register" })).json.id as string;
    const stock = (await call("POST", "/registers", { name: "സ്റ്റോക്ക് രജിസ്റ്റർ" })).json.id as string;
    expect((await call("POST", "/registers", { name: " service BOOK register " })).status).toBe(409);
    await call("POST", "/registers/order", { ids: [stock, sb] });
    await call("PATCH", `/registers/${sb}`, { updatedUntil: "2026-10-10" });
    expect((await registers()).map((r) => [r.name, r.updatedUntil])).toEqual([["സ്റ്റോക്ക് രജിസ്റ്റർ", null], ["Service book register", "2026-10-10"]]);
    await call("POST", "/register-entries", { registerId: stock, text: "Enter new chairs", dueDate: "2026-10-20" });
    await call("DELETE", `/registers/${stock}`);
    expect((await registers()).map((r) => r.name)).toEqual(["Service book register"]);
    expect(await entries()).toEqual([]);
    expect(((await call("GET", "/tasks?view=any")).json.tasks as Task[]).filter((t) => t.title.startsWith("സ്റ്റോക്ക്"))).toEqual([]);
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((h) => h.summary);
    expect(history).toContain("Service book register updated until 10 Oct 2026");
  });

  it("entries are not tasks unless given a due date; then entry and task stay in step both ways", async () => {
    const reg = (await call("POST", "/registers", { name: "Leave register" })).json.id as string;
    const emp = (await call("POST", "/staff/employees", { name: "Anila" })).json.id as string;
    const plain = await call("POST", "/register-entries", { registerId: reg, text: "Enter EL of September", employeeId: emp });
    expect(plain.json.taskId).toBeNull();
    const before = ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).length;

    // A due date makes the task, For the employee.
    await call("PATCH", `/register-entries/${plain.json.id}`, { dueDate: "2026-10-25" });
    const e = (await entries())[0]!;
    expect(e.task).toMatchObject({ dueDate: "2026-10-25", status: "open" });
    const t = (await task(e.task!.id))!;
    expect([t.title, t.relatedKind, t.relatedId]).toEqual(["Leave register: Enter EL of September", "employee", emp]);
    expect(((await call("GET", "/tasks?view=any")).json.tasks as Task[]).length).toBe(before + 1);

    // Completing the task ticks the entry; reopening the entry reopens the task.
    await call("POST", `/tasks/${t.id}/complete`);
    expect((await entries())[0]!.status).toBe("done");
    await call("POST", `/register-entries/${e.id}/done`, { done: false });
    expect((await task(t.id))!.status).toBe("open");
    await call("POST", `/register-entries/${e.id}/done`, { done: true });
    expect([(await entries())[0]!.status, (await task(t.id))!.status]).toEqual(["done", "done"]);
    expect((await registers())[0]).toMatchObject({ open: 0, done: 1 });

    // Taking the due date away removes an open task.
    await call("POST", `/register-entries/${e.id}/done`, { done: false });
    await call("PATCH", `/register-entries/${e.id}`, { dueDate: null });
    expect([(await entries())[0]!.task, await task(t.id)]).toEqual([null, undefined]);

    expect((await call("POST", "/register-entries", { registerId: reg, text: "x", employeeId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
  });

  it("Updated marks the register updated until today and clears its done entries", async () => {
    const reg = (await call("POST", "/registers", { name: "Stationary Register" })).json.id as string;
    const a = (await call("POST", "/register-entries", { registerId: reg, text: "Done one", dueDate: "2026-10-20" })).json;
    await call("POST", "/register-entries", { registerId: reg, text: "Still pending" });
    await call("POST", `/register-entries/${a.id}/done`, { done: true });
    const res = await call("POST", `/registers/${reg}/updated`, { date: "2026-10-17" });
    expect(res.json.cleared).toBe(1);
    expect((await registers())[0]).toMatchObject({ updatedUntil: "2026-10-17", open: 1, done: 0 });
    expect((await entries()).map((e) => e.text)).toEqual(["Still pending"]);
    // Its completed task stays.
    expect((await task(a.taskId))!.status).toBe("done");
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((h) => h.summary);
    expect(history).toContain("Stationary Register updated until 17 Oct 2026 (1 done entry cleared)");
  });
});
