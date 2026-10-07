// Staff page (user request 2026-10-07): designations and employees, and tasks / reminders about an employee,
// a designation or the general office.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { COMMON_DESIGNATIONS, incrementDue, incrementOnHome, nextYear } from "../src/shared/staff";
import type { Report, StaffList, Summary, Task } from "../src/shared/types";

const NAME = "ശ്രീമതി. ലക്ഷ്മി കുട്ടി അമ്മ കെ. എസ്. (ജൂനിയർ പബ്ലിക് ഹെൽത്ത് നഴ്സ്, പ്രാഥമികാരോഗ്യ കേന്ദ്രം)";

describe("staff", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const staff = async () => (await call("GET", "/staff")).json as StaffList;
  const task = async (id: string) => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.id === id)!;
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("adds the common designations once, in order", async () => {
    expect((await call("POST", "/staff/designations/common")).json).toEqual({ added: COMMON_DESIGNATIONS.length });
    expect((await call("POST", "/staff/designations/common")).json).toEqual({ added: 0 });
    expect((await staff()).designations.map((d) => d.name)).toEqual(COMMON_DESIGNATIONS);
  });

  it("links tasks to an employee, a designation or the office, and shows an employee's work", async () => {
    const jphn = (await call("POST", "/staff/designations", { name: "JPHN" })).json.id as string;
    const emp = (await call("POST", "/staff/employees", { name: NAME, designationId: jphn, pen: "123456", category: "OBC", dateOfBirth: "1980-05-31", nextIncrementOn: "2027-03-01" })).json;
    expect(emp).toMatchObject({ name: NAME, pen: "123456", category: "OBC", nextIncrementOn: "2027-03-01", leftOn: null });

    const forHer = (await call("POST", "/tasks", { title: "Increment sanction", relatedKind: "employee", relatedId: emp.id })).json.id as string;
    const forAll = (await call("POST", "/tasks", { title: "JPHN duty roster", relatedKind: "designation", relatedId: jphn })).json.id as string;
    const office = (await call("POST", "/tasks", { title: "Electricity bill", relatedKind: "office", relatedId: emp.id })).json.id as string;
    expect(await task(forHer)).toMatchObject({ relatedKind: "employee", relatedId: emp.id });
    expect(await task(office)).toMatchObject({ relatedKind: "office", relatedId: null });

    const work = (await call("GET", `/staff/employees/${emp.id}/work`)).json;
    expect(work.tasks.map((t: Task) => t.title).sort()).toEqual(["Increment sanction", "JPHN duty roster"]);

    // Changing it is logged; clearing it too.
    await call("PATCH", `/tasks/${forAll}`, { relatedKind: "employee", relatedId: emp.id });
    await call("PATCH", `/tasks/${office}`, { relatedKind: null, relatedId: null });
    expect(await task(office)).toMatchObject({ relatedKind: null, relatedId: null });
    const history = JSON.stringify((await call("GET", "/history")).json);
    expect(history).toContain(`For: ${NAME}`);
    expect(history).toContain("No longer linked to staff");

    // Someone else's or a made-up employee is refused.
    expect((await call("POST", "/tasks", { title: "x", relatedKind: "employee", relatedId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
    expect((await call("POST", "/tasks", { title: "x", relatedKind: "designation", relatedId: null })).status).toBe(400);
  });

  it("protects linked employees and designations: Left the office instead of delete", async () => {
    const clerk = (await call("POST", "/staff/designations", { name: "Clerk" })).json.id as string;
    const emp = (await call("POST", "/staff/employees", { name: "Anil", designationId: clerk })).json.id as string;
    await call("POST", "/tasks", { title: "Service book", relatedKind: "employee", relatedId: emp });
    expect((await call("DELETE", `/staff/employees/${emp}`)).status).toBe(409);
    expect((await call("DELETE", `/staff/designations/${clerk}`)).status).toBe(409);
    await call("POST", `/staff/employees/${emp}/left`, { left: true });
    expect((await staff()).employees[0]!.leftOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const spare = (await call("POST", "/staff/employees", { name: "Not linked" })).json.id as string;
    expect((await call("DELETE", `/staff/employees/${spare}`)).status).toBe(200);
    // Bad details are refused.
    expect((await call("POST", "/staff/employees", { name: "x", email: "not-an-email" })).status).toBe(400);
    expect((await call("POST", "/staff/employees", { name: "x", category: "Unknown" })).status).toBe(400);
  });

  it("permanent or temporary: temporary ones keep no increment, retirement or probation dates", async () => {
    const id = (await call("POST", "/staff/employees", { name: NAME, permanent: false, engagedTill: "2027-03-31", nextIncrementOn: "2026-01-01", retiresOn: "2040-05-31" })).json.id as string;
    expect((await staff()).employees.find((e) => e.id === id)).toMatchObject({ permanent: false, engagedTill: "2027-03-31", nextIncrementOn: null, retiresOn: null });
    expect(((await call("GET", "/summary")).json as Summary).incrementsDue).toEqual([]);
    // Made permanent: the end date goes, the service dates stay.
    await call("PUT", `/staff/employees/${id}`, { name: NAME, permanent: true, engagedTill: "2027-03-31", retiresOn: "2040-05-31" });
    expect((await staff()).employees.find((e) => e.id === id)).toMatchObject({ permanent: true, engagedTill: null, retiresOn: "2040-05-31" });
    // Old clients that don't send it get a permanent employee.
    expect((await call("POST", "/staff/employees", { name: "x" })).json).toMatchObject({ permanent: true });
  });

  it("a reminder's tasks carry what it is about, and follow a change", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const hc = (await call("POST", "/staff/designations", { name: "Head Clerk" })).json.id as string;
    const rid = (await call("POST", "/reports", { name: "Monthly establishment return", startDate: today, relatedKind: "office" })).json.id as string;
    const mine = async () => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.report?.reportId === rid)!;
    expect(await mine()).toMatchObject({ relatedKind: "office" });
    await call("PATCH", `/reports/${rid}`, { relatedKind: "designation", relatedId: hc });
    expect(await mine()).toMatchObject({ relatedKind: "designation", relatedId: hc });
    const r = ((await call("GET", "/reports")).json.reports as Report[]).find((x) => x.id === rid)!;
    expect(r).toMatchObject({ relatedKind: "designation", relatedId: hc });
  });

  it("increments: due this month, on Home from the 20th, done moves them a year on, Undo puts them back", async () => {
    expect(nextYear("2027-06-01")).toBe("2028-06-01");
    expect(nextYear("2028-02-29")).toBe("2029-02-28");
    expect(incrementDue("2026-10-01", "2026-10-07")).toBe(true);
    expect(incrementDue("2026-11-01", "2026-10-31")).toBe(false);
    expect(incrementOnHome("2026-10-01", "2026-10-19")).toBe(false); // this month, before the 20th
    expect(incrementOnHome("2026-10-01", "2026-10-20")).toBe(true);
    expect(incrementOnHome("2026-09-01", "2026-10-05")).toBe(true); // an earlier month's, not done yet
    expect(incrementOnHome("2026-11-01", "2026-10-25")).toBe(false);

    const today = (await call("GET", "/me")).json.today as string;
    const lastMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const overdueDay = lastMonth.toISOString().slice(0, 10);
    const nextMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const late = (await call("POST", "/staff/employees", { name: NAME, nextIncrementOn: overdueDay })).json.id as string;
    await call("POST", "/staff/employees", { name: "Not yet", nextIncrementOn: nextMonth.toISOString().slice(0, 10) });
    await call("POST", "/staff/employees", { name: "Gone", nextIncrementOn: overdueDay });
    const gone = (await staff()).employees.find((e) => e.name === "Gone")!.id;
    await call("POST", `/staff/employees/${gone}/left`, { left: true });

    const summary = async () => (await call("GET", "/summary")).json as Summary;
    let s = await summary();
    expect(s.incrementsDue.map((i) => i.name)).toEqual([NAME]);
    expect(s.counts.incrementsDue).toBe(1);

    const r = (await call("POST", `/staff/employees/${late}/increment`)).json;
    expect(r).toEqual({ previous: overdueDay, next: nextYear(overdueDay) });
    s = await summary();
    expect(s.incrementsDue).toEqual([]);
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("marked done");

    await call("POST", `/staff/employees/${late}/increment`, { undoTo: overdueDay });
    expect((await staff()).employees.find((e) => e.id === late)!.nextIncrementOn).toBe(overdueDay);
    // No date: nothing to mark.
    const none = (await call("POST", "/staff/employees", { name: "No date" })).json.id as string;
    expect((await call("POST", `/staff/employees/${none}/increment`)).status).toBe(400);
  });
});
