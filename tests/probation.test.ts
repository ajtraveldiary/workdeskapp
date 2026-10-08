// Probation pending (user request 2026-10-08): a "Probation declaration" task from 7 days before a permanent
// employee completes 2 years of service with no declared date; declared completes it (Undo reopens), the due
// date can be changed, and a date entered in the employee form completes it.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { ensureProbationTasks } from "../src/server/lib/probation";
import { probationDue, probationTaskTitle, yearBefore } from "../src/shared/staff";
import type { StaffList, Task } from "../src/shared/types";

const NAME = "ശ്രീമതി. ലക്ഷ്മി കുട്ടി അമ്മ കെ. എസ്. (ജൂനിയർ പബ്ലിക് ഹെൽത്ത് നഴ്സ്, പ്രാഥമികാരോഗ്യ കേന്ദ്രം)";
const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Joined so that 2 years complete `n` days from today.
const joinedFor = (today: string, n: number) => yearBefore(yearBefore(plusDays(today, n)));

describe("probation tasks", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const probation = async () => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).filter((t) => t.systemKind === "probation");
  const staff = async () => (await call("GET", "/staff")).json as StaffList;
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("dates", () => {
    expect(probationDue("2024-10-15")).toBe("2026-10-15");
    expect(probationDue("2024-02-29")).toBe("2026-02-28");
  });

  it("makes one task from 7 days before 2 years, for permanent staff without a declared date", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const id = (await call("POST", "/staff/employees", { name: NAME, joinedServiceOn: joinedFor(today, 5) })).json.id as string;
    await call("POST", "/staff/employees", { name: "Not yet", joinedServiceOn: joinedFor(today, 30) });
    await call("POST", "/staff/employees", { name: "Declared", joinedServiceOn: joinedFor(today, -10), probationDeclaredOn: today });
    await call("POST", "/staff/employees", { name: "Temporary", permanent: false, joinedServiceOn: joinedFor(today, -10) });
    // Old staff whose date was never entered: no task (2 years done long ago).
    await call("POST", "/staff/employees", { name: "Old timer", joinedServiceOn: joinedFor(today, -3 * 365) });
    // Overdue but recent: a task.
    await call("POST", "/staff/employees", { name: "Late", joinedServiceOn: joinedFor(today, -40) });

    const tasks = await probation();
    expect(tasks.map((t) => t.title).sort()).toEqual([probationTaskTitle(NAME), probationTaskTitle("Late")].sort());
    const mine = tasks.find((t) => t.relatedId === id)!;
    expect(mine).toMatchObject({ dueDate: plusDays(today, 5), priority: "high", madeBySystem: true, relatedKind: "employee", status: "open" });
    // Made once, even after it is deleted.
    await ensureProbationTasks(db, today);
    expect(await probation()).toHaveLength(2);
    await call("POST", "/tasks/bulk-delete", { ids: [mine.id] });
    await ensureProbationTasks(db, today);
    expect((await probation()).map((t) => t.relatedId)).not.toContain(id);
  });

  it("declared completes it with today's date; Undo reopens; the due date can change; the form completes it", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const id = (await call("POST", "/staff/employees", { name: NAME, joinedServiceOn: joinedFor(today, 2) })).json.id as string;
    const task = (await probation())[0]!;

    expect((await call("POST", `/staff/employees/${id}/probation`)).json).toEqual({ declaredOn: today });
    expect((await staff()).employees.find((e) => e.id === id)!.probationDeclaredOn).toBe(today);
    expect((await probation())[0]!.status).toBe("done");
    await call("POST", `/staff/employees/${id}/probation`, { undo: true, declaredOn: today });
    expect((await staff()).employees.find((e) => e.id === id)!.probationDeclaredOn).toBeNull();
    expect((await probation())[0]!.status).toBe("open");

    // Probation extended: the task's due date moves, and it stays open.
    await call("PATCH", `/tasks/${task.id}`, { dueDate: plusDays(today, 90) });
    expect((await probation())[0]).toMatchObject({ dueDate: plusDays(today, 90), status: "open" });

    // Declared date entered in the employee form: the open task is completed.
    const e = (await staff()).employees.find((x) => x.id === id)!;
    await call("PUT", `/staff/employees/${id}`, { ...e, probationDeclaredOn: today });
    expect((await probation())[0]!.status).toBe("done");
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("declared on");
    // Temporary employees have no probation.
    const temp = (await call("POST", "/staff/employees", { name: "T", permanent: false })).json.id as string;
    expect((await call("POST", `/staff/employees/${temp}/probation`)).status).toBe(400);
  });
});
