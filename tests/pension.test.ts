// Retiring within 12 months (user request 2026-10-08): a "Pension papers" task 12 months before an employee
// retires, made once, with the pension checklist, and the Employees page's list of those retiring.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { ensurePensionTasks } from "../src/server/lib/pension";
import { PENSION_CHECKLIST, nextYear, pensionTaskTitle, retiringSoon, yearBefore } from "../src/shared/staff";
import type { RetiringEmployee, Task } from "../src/shared/types";

const NAME = "ശ്രീമതി. ലക്ഷ്മി കുട്ടി അമ്മ കെ. എസ്. (ജൂനിയർ പബ്ലിക് ഹെൽത്ത് നഴ്സ്, പ്രാഥമികാരോഗ്യ കേന്ദ്രം)";
const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe("pension tasks", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const allTasks = async () => (await call("GET", "/tasks?view=any")).json.tasks as Task[];
  const pensionTasks = async () => (await allTasks()).filter((t) => t.title.startsWith("Pension papers"));
  const retiring = async () => (await call("GET", "/staff/retiring")).json.retiring as RetiringEmployee[];
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("dates: a year before, within 12 months", () => {
    expect(yearBefore("2027-05-31")).toBe("2026-05-31");
    expect(yearBefore("2028-02-29")).toBe("2027-02-28");
    expect(retiringSoon("2027-10-08", "2026-10-08")).toBe(true);
    expect(retiringSoon("2027-10-09", "2026-10-08")).toBe(false);
    expect(retiringSoon("2026-09-30", "2026-10-08")).toBe(true); // past the date, still in the office
    expect(retiringSoon(null, "2026-10-08")).toBe(false);
  });

  it("makes one Pension papers task 12 months before, about the employee, with the checklist", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const soon = plusDays(today, 200);
    const id = (await call("POST", "/staff/employees", { name: NAME, retiresOn: soon })).json.id as string;
    await call("POST", "/staff/employees", { name: "Later", retiresOn: plusDays(nextYear(today), 1) });
    // Left the office before the task was made: none for them.
    const [me] = await db.select({ userId: schema.employees.userId }).from(schema.employees).limit(1);
    await db.insert(schema.employees).values({ userId: me!.userId, name: "Gone", retiresOn: plusDays(today, 30), leftOn: today });
    await ensurePensionTasks(db, today);

    const made = await pensionTasks();
    expect(made.map((t) => t.title)).toEqual([pensionTaskTitle(NAME)]);
    expect(made[0]).toMatchObject({ dueDate: yearBefore(soon), priority: "high", status: "open", relatedKind: "employee", relatedId: id });
    expect(made[0]!.checklist.map((s) => s.text)).toEqual(PENSION_CHECKLIST);
    expect(made[0]!.notes).toContain("Retires on");

    // Made once: running again, or deleting the task, never makes another.
    await ensurePensionTasks(db, today);
    expect(await pensionTasks()).toHaveLength(1);
    await call("POST", "/tasks/bulk-delete", { ids: [made[0]!.id] });
    await ensurePensionTasks(db, today);
    expect(await pensionTasks()).toHaveLength(0);
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("retiring on");
  });

  it("temporary employees and dates more than a year away get no task; a later edit into the window does", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    await call("POST", "/staff/employees", { name: "Temp", permanent: false, retiresOn: plusDays(today, 100) });
    const far = (await call("POST", "/staff/employees", { name: "Far", retiresOn: plusDays(today, 800) })).json.id as string;
    expect(await pensionTasks()).toEqual([]);
    await call("PUT", `/staff/employees/${far}`, { name: "Far", retiresOn: plusDays(today, 90) });
    expect((await pensionTasks()).map((t) => t.title)).toEqual([pensionTaskTitle("Far")]);
  });

  it("lists those retiring within 12 months, soonest first, with their task", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const a = (await call("POST", "/staff/employees", { name: NAME, retiresOn: plusDays(today, 300) })).json.id as string;
    await call("POST", "/staff/employees", { name: "Sooner", retiresOn: plusDays(today, 20) });
    await call("POST", "/staff/employees", { name: "Not yet", retiresOn: plusDays(today, 500) });
    const list = await retiring();
    expect(list.map((r) => r.name)).toEqual(["Sooner", NAME]);
    const mine = list.find((r) => r.employeeId === a)!;
    expect(mine.task?.title).toBe(pensionTaskTitle(NAME));

    // Completing the task (papers sent) keeps them listed, with the task done.
    await call("POST", `/tasks/${mine.task!.id}/complete`);
    expect((await retiring()).find((r) => r.employeeId === a)!.task?.status).toBe("done");
    // Left the office: off the list.
    await call("POST", `/staff/employees/${a}/left`, { left: true });
    expect((await retiring()).map((r) => r.name)).toEqual(["Sooner"]);
  });
});
