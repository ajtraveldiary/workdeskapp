// Staff page (user request 2026-10-07): designations and employees, and tasks / reminders about an employee,
// a designation or the general office.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { COMMON_DESIGNATIONS, contractEnd, contractOnHome, contractOver, incrementDue, incrementOnHome, nextYear, renewedEnd } from "../src/shared/staff";
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

  it("temporary employees: engagement, type, contract days, pay per day; types are edited in Settings", async () => {
    expect(contractEnd("2026-10-01", 179)).toBe("2027-03-28");
    expect((await call("POST", "/staff/types/common")).json).toEqual({ added: 4 });
    expect((await call("POST", "/staff/types/common")).json).toEqual({ added: 0 });
    const types = (await staff()).types;
    expect(types.map((t) => t.name)).toEqual(["HMC", "NHM", "Block Panchayath Project", "Gramapanchayath Project"]);
    const nhm = types[1]!.id;
    const id = (
      await call("POST", "/staff/employees", {
        name: NAME, permanent: false, engagement: "daily_wage", typeId: nhm, contractDays: 179, payPerDay: 755.5,
        joinedServiceOn: "2026-10-01", engagedTill: "2027-03-28", pen: "999", address: "Somewhere", notes: "x", payScale: "y",
      })
    ).json.id as string;
    // Only the temporary details are kept.
    expect((await staff()).employees.find((e) => e.id === id)).toMatchObject({ engagement: "daily_wage", typeId: nhm, contractDays: 179, payPerDay: 755.5, pen: "", address: "", notes: "", payScale: "" });
    // A type an employee has can't be removed; renaming and moving are fine.
    expect((await call("DELETE", `/staff/types/${nhm}`)).status).toBe(409);
    await call("PATCH", `/staff/types/${nhm}`, { name: "National Health Mission" });
    await call("POST", `/staff/types/${nhm}/move`, { by: -1 });
    expect((await staff()).types.slice(0, 2).map((t) => t.name)).toEqual(["National Health Mission", "HMC"]);
    expect((await call("DELETE", `/staff/types/${types[0]!.id}`)).status).toBe(200);
    // Bad values are refused; a permanent employee keeps none of the temporary details.
    expect((await call("POST", "/staff/employees", { name: "x", permanent: false, engagement: "casual" })).status).toBe(400);
    expect((await call("POST", "/staff/employees", { name: "x", permanent: false, contractDays: 0 })).status).toBe(400);
    await call("PUT", `/staff/employees/${id}`, { name: NAME, permanent: true, engagement: "contract", typeId: nhm, contractDays: 10, payPerDay: 1 });
    expect((await staff()).employees.find((e) => e.id === id)).toMatchObject({ engagement: "", typeId: null, contractDays: null, payPerDay: null });
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("Employee type renamed");
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
    expect(r).toMatchObject({ previous: overdueDay, next: nextYear(overdueDay) });
    s = await summary();
    expect(s.incrementsDue).toEqual([]);
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("marked done");

    await call("POST", `/staff/employees/${late}/increment`, { undoTo: overdueDay });
    expect((await staff()).employees.find((e) => e.id === late)!.nextIncrementOn).toBe(overdueDay);
    // No date: nothing to mark.
    const none = (await call("POST", "/staff/employees", { name: "No date" })).json.id as string;
    expect((await call("POST", `/staff/employees/${none}/increment`)).status).toBe(400);
  });

  it("contracts ending: a Contract ends task from 7 days before; renew or end completes it, Undo reopens it", async () => {
    expect(contractOnHome("2026-10-15", "2026-10-08")).toBe(true); // 7 days ahead
    expect(contractOnHome("2026-10-16", "2026-10-08")).toBe(false);
    expect(contractOnHome("2026-09-30", "2026-10-08")).toBe(true); // past, not dealt with
    expect(contractOnHome(null, "2026-10-08")).toBe(false);
    expect(contractOver("2026-10-07", "2026-10-08")).toBe(true);
    expect(contractOver("2026-10-08", "2026-10-08")).toBe(false);
    expect(renewedEnd("2027-03-28", 179)).toBe("2027-09-23"); // 29 Mar + 179 days − 1

    const today = (await call("GET", "/me")).json.today as string;
    const soon = contractEnd(today, 5); // ends in 4 days
    const later = contractEnd(today, 30);
    const temp = (await call("POST", "/staff/employees", { name: NAME, permanent: false, engagement: "contract", contractDays: 179, joinedServiceOn: "2026-04-01", engagedTill: soon })).json.id as string;
    const noDays = (await call("POST", "/staff/employees", { name: "No period", permanent: false, engagedTill: soon })).json.id as string;
    await call("POST", "/staff/employees", { name: "Not yet", permanent: false, contractDays: 30, engagedTill: later });
    const contractTasks = async () => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).filter((t) => t.systemKind === "contract");
    const open = async () => (await contractTasks()).filter((t) => t.status === "open").map((t) => t.relatedId).sort();
    let tasks = await contractTasks();
    expect(tasks.map((t) => t.title).sort()).toEqual([`Contract ends: ${NAME}`, "Contract ends: No period"].sort());
    expect(tasks.find((t) => t.relatedId === temp)).toMatchObject({ dueDate: soon, priority: "high", madeBySystem: true, relatedKind: "employee", status: "open" });
    expect(tasks.find((t) => t.relatedId === temp)!.notes).toContain("179 days");
    // The old Home rows are gone: the summary counts them as tasks (upcoming here).
    expect((await call("GET", "/summary")).json).not.toHaveProperty("contractsEnding");

    // Renew: the same 179 days again from the day after it ends, and the task is completed; Undo puts the old
    // end date back and reopens it. No second task is made for the same end date.
    const r = (await call("POST", `/staff/employees/${temp}/contract/renew`)).json;
    expect(r).toEqual({ previous: soon, next: renewedEnd(soon, 179) });
    expect(await open()).toEqual([noDays]);
    await call("POST", `/staff/employees/${temp}/contract/renew`, { undoTo: soon });
    expect((await staff()).employees.find((e) => e.id === temp)!.engagedTill).toBe(soon);
    expect(await open()).toEqual([noDays, temp].sort());
    await call("POST", "/maintain");
    expect(await contractTasks()).toHaveLength(2);
    // No contract period: renew is refused (set it on the employee first).
    expect((await call("POST", `/staff/employees/${noDays}/contract/renew`)).status).toBe(400);

    // Ended: left the office on the end date and the task completed; Undo brings them back and reopens it.
    expect((await call("POST", `/staff/employees/${noDays}/contract/ended`)).json).toEqual({ leftOn: soon });
    expect((await staff()).employees.find((e) => e.id === noDays)!.leftOn).toBe(soon);
    expect(await open()).toEqual([temp]);
    await call("POST", `/staff/employees/${noDays}/contract/ended`, { undo: true });
    expect((await staff()).employees.find((e) => e.id === noDays)!.leftOn).toBeNull();
    expect(await open()).toEqual([noDays, temp].sort());

    // An edited end date moves the open task to it; one beyond 7 days still keeps it (now upcoming).
    const e = (await staff()).employees.find((x) => x.id === temp)!;
    await call("PUT", `/staff/employees/${temp}`, { ...e, engagedTill: later });
    tasks = await contractTasks();
    expect(tasks.filter((t) => t.relatedId === temp)).toHaveLength(1);
    expect(tasks.find((t) => t.relatedId === temp)!.dueDate).toBe(later);

    const history = JSON.stringify((await call("GET", "/history")).json);
    expect(history).toContain("renewed for 179 days");
    expect(history).toContain("left the office");
    // Permanent employees have no contract.
    const perm = (await call("POST", "/staff/employees", { name: "Permanent" })).json.id as string;
    expect((await call("POST", `/staff/employees/${perm}/contract/ended`)).status).toBe(400);
  });

  it("basic pay: its own field, saved with an increment and put back by Undo; shown with increments due", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const lastMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const due = lastMonth.toISOString().slice(0, 10);
    const id = (await call("POST", "/staff/employees", { name: NAME, payScale: "35600-75400", basicPay: 41300, nextIncrementOn: due })).json.id as string;
    const emp = async () => (await staff()).employees.find((e) => e.id === id)!;
    expect(await emp()).toMatchObject({ payScale: "35600-75400", basicPay: 41300 });
    expect(((await call("GET", "/summary")).json as Summary).incrementsDue[0]).toMatchObject({ employeeId: id, basicPay: 41300 });

    // Done with the new basic pay; Undo puts back both.
    const r = (await call("POST", `/staff/employees/${id}/increment`, { basicPay: 42500 })).json;
    expect(r).toEqual({ previous: due, next: nextYear(due), previousBasicPay: 41300, basicPay: 42500 });
    expect(await emp()).toMatchObject({ nextIncrementOn: nextYear(due), basicPay: 42500 });
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("basic pay ₹41,300 → ₹42,500");
    await call("POST", `/staff/employees/${id}/increment`, { undoTo: due, restoreBasicPay: 41300 });
    expect(await emp()).toMatchObject({ nextIncrementOn: due, basicPay: 41300 });
    // Done without sending a basic pay leaves it alone; a bad one is refused.
    await call("POST", `/staff/employees/${id}/increment`);
    expect((await emp()).basicPay).toBe(41300);
    expect((await call("POST", `/staff/employees/${id}/increment`, { basicPay: -5 })).status).toBe(400);

    // An older form that doesn't send basicPay doesn't clear it; temporary staff have none.
    const e = await emp();
    const { basicPay: _b, ...rest } = e;
    await call("PUT", `/staff/employees/${id}`, rest);
    expect((await emp()).basicPay).toBe(41300);
    await call("PUT", `/staff/employees/${id}`, { ...e, permanent: false });
    expect((await emp()).basicPay).toBeNull();
  });
});
