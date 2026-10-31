// Attendance register, phase 1 (user request 2026-10-31, docs/ATTENDANCE_PLAN.md): the month as the register shows
// it, marking a day for everyone in one go and chosen cells, what is left out (leave, holidays, not in the office,
// other marks), clearing, the year's CL total, holidays and second Saturdays, and the settings.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { holidayOn, isSecondSaturday, monthDays, offByItself, shiftMonth } from "../src/shared/attendance";
import type { AttendanceMonth, AuditEvent, LeaveType } from "../src/shared/types";

const NAME = "2026-27 സാമ്പത്തിക വർഷത്തെ ജൂനിയർ ഹെൽത്ത് ഇൻസ്‌പെക്ടർ ശ്രീമതി അനിതാകുമാരി രാധാകൃഷ്ണൻ";

describe("attendance register", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const month = async (m: string) => (await call("GET", `/attendance?month=${m}`)).json as AttendanceMonth;
  const add = async (body: Record<string, unknown>) => (await call("POST", "/staff/employees", body)).json.id as string;
  const history = async () => ((await call("GET", "/history")).json.events as AuditEvent[]).map((e) => e.summary);
  const markOf = (m: AttendanceMonth, id: string, date: string) => m.marks.find((x) => x.employeeId === id && x.date === date)?.mark;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("works out the month's days, second Saturdays and which days are off by themselves", () => {
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2028-02")).toHaveLength(29);
    expect(monthDays("2026-10")[30]).toBe("2026-10-31");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(["2026-10-10", "2026-10-03", "2026-10-17", "2026-11-14"].map(isSecondSaturday)).toEqual([true, false, false, true]);
    const on = { secondSaturday: true, clPerYear: 20 };
    expect(holidayOn("2026-10-10", new Map(), on)).toEqual({ name: "Second Saturday", kind: "second_saturday" });
    expect(holidayOn("2026-10-10", new Map(), { ...on, secondSaturday: false })).toBeNull();
    expect(holidayOn("2026-10-02", new Map([["2026-10-02", "Gandhi Jayanthi"]]), on)).toEqual({ name: "Gandhi Jayanthi", kind: "public" });
    // A Sunday is off by itself only for Sunday-off staff.
    expect([offByItself("2026-10-04", null, "sunday"), offByItself("2026-10-04", null, "weekly"), offByItself("2026-10-05", null, "sunday")]).toEqual([true, false, false]);
  });

  it("lists everyone in the office that month, permanent first, and marks a day for everyone in one go", async () => {
    const a = await add({ name: NAME, joinedOfficeOn: "2020-01-01" });
    const b = await add({ name: "Mary Thomas", offDay: "weekly" });
    const t = await add({ name: "Daily wage", permanent: false });
    const later = await add({ name: "Joins later", joinedOfficeOn: "2026-11-05" });
    const gone = await add({ name: "Left in September", joinedOfficeOn: "2020-01-01" });
    // Relieved on 30 September: not in October's register.
    await call("POST", "/moves", { employeeId: gone, kind: "relieve", date: "2026-09-30" });
    const oct = await month("2026-10");
    expect(oct.days).toHaveLength(31);
    expect(oct.employees.map((e) => e.name)).toEqual(expect.arrayContaining([NAME, "Mary Thomas", "Daily wage"]));
    expect(oct.employees.some((e) => e.id === later)).toBe(false);
    expect(oct.employees.some((e) => e.id === gone)).toBe(false);
    expect((await month("2026-09")).employees.some((e) => e.id === gone)).toBe(true);
    expect(oct.employees[oct.employees.length - 1]!.id).toBe(t);
    // Everyone on Monday 5 Oct.
    const r = await call("POST", "/attendance/mark", { cells: [a, b, t].map((employeeId) => ({ employeeId, date: "2026-10-05" })), mark: "present" });
    expect(r.json).toEqual({ marked: 3, skipped: {} });
    const after = await month("2026-10");
    expect([a, b, t].map((id) => markOf(after, id, "2026-10-05"))).toEqual(["present", "present", "present"]);
    expect(await history()).toContain("Attendance 5 Oct 2026: Present for 3 people");
    expect((await month("2026-11")).employees.some((e) => e.id === later)).toBe(true);
  });

  it("leaves out holidays, Sunday-off Sundays, offs for Sunday-off staff, other marks and days not in the office", async () => {
    const a = await add({ name: NAME });
    const w = await add({ name: "Weekly", offDay: "weekly" });
    const late = await add({ name: "Late joiner", joinedOfficeOn: "2026-10-20" });
    await call("POST", "/attendance/holidays", { date: "2026-10-02", name: "Gandhi Jayanthi" });
    // CL on a holiday, a Sunday (4 Oct) and the second Saturday (10 Oct): only the weekly-off Sunday takes it.
    const cl = await call("POST", "/attendance/mark", {
      cells: ["2026-10-02", "2026-10-04", "2026-10-10"].flatMap((date) => [a, w].map((employeeId) => ({ employeeId, date }))),
      mark: "cl",
    });
    expect(cl.json).toEqual({ marked: 1, skipped: { holiday: 5 } });
    // Present on a holiday is holiday duty, allowed.
    expect((await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-10-02" }], mark: "present" })).json.marked).toBe(1);
    // An off is for weekly-off staff only.
    const off = await call("POST", "/attendance/mark", { cells: [a, w].map((employeeId) => ({ employeeId, date: "2026-10-06" })), mark: "off" });
    expect(off.json).toEqual({ marked: 1, skipped: { "Sunday-off staff": 1 } });
    // A cell with another mark stays unless replace; the same mark is left alone.
    const keep = await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: "2026-10-06" }, { employeeId: w, date: "2026-10-04" }], mark: "present" });
    expect(keep.json).toEqual({ marked: 0, skipped: { "has another mark": 2 } });
    const replace = await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: "2026-10-06" }], mark: "present", replace: true });
    expect(replace.json.marked).toBe(1);
    expect((await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: "2026-10-06" }], mark: "present" })).json.skipped).toEqual({ "already marked": 1 });
    // Before joining this office.
    expect((await call("POST", "/attendance/mark", { cells: [{ employeeId: late, date: "2026-10-19" }], mark: "present" })).json.skipped).toEqual({ "not in the office": 1 });
    // Compensation leave comes in phase 2.
    expect((await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-10-05" }], mark: "ch" })).status).toBe(400);
    const oct = await month("2026-10");
    expect(oct.days.find((d) => d.date === "2026-10-02")!.holiday).toEqual({ name: "Gandhi Jayanthi", kind: "public" });
    expect(markOf(oct, w, "2026-10-04")).toBe("cl");
    expect(markOf(oct, w, "2026-10-06")).toBe("present");
  });

  it("shows leave from the Leave page in its days and keeps marks off them", async () => {
    const a = await add({ name: NAME });
    const hpl = ((await call("GET", "/leave/types")).json.types as LeaveType[]).find((t) => t.short === "HPL")!;
    await call("POST", `/leave/accounts/${a}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    const leave = (await call("POST", "/leave/leaves", { employeeId: a, typeId: hpl.id, fromDate: "2026-09-28", toDate: "2026-10-03", days: 6 })).json.id as string;
    const oct = await month("2026-10");
    expect(oct.leaves).toEqual([{ employeeId: a, from: "2026-10-01", to: "2026-10-03", short: "HPL", name: "Half pay leave" }]);
    expect((await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-10-01" }], mark: "present" })).json.skipped).toEqual({ "on leave": 1 });
    // Rejoining early shortens it in the register; cancelling takes it away.
    await call("PUT", `/leave/leaves/${leave}`, { typeId: hpl.id, fromDate: "2026-09-28", toDate: "2026-10-03", days: 4, rejoinedOn: "2026-10-02" });
    expect((await month("2026-10")).leaves[0]!.to).toBe("2026-10-01");
    await call("POST", `/leave/leaves/${leave}/cancel`);
    expect((await month("2026-10")).leaves).toEqual([]);
  });

  it("counts the year's casual leave (half days as ½) and clears marks", async () => {
    const a = await add({ name: NAME });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-03-02" }, { employeeId: a, date: "2026-10-05" }], mark: "cl" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-10-06" }], mark: "cl_half" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2025-12-01" }], mark: "cl" });
    expect((await month("2026-10")).totals).toEqual([{ employeeId: a, cl: 2.5, ch: 0 }]);
    expect((await month("2025-12")).totals[0]!.cl).toBe(1);
    const cleared = await call("POST", "/attendance/clear", { cells: [{ employeeId: a, date: "2026-10-05" }, { employeeId: a, date: "2026-10-07" }] });
    expect(cleared.json.cleared).toBe(1);
    expect((await month("2026-10")).totals[0]!.cl).toBe(1.5);
    expect(await history()).toContain(`Attendance 5 Oct 2026: marks cleared for ${NAME}`);
  });

  it("keeps holidays and settings, each in History", async () => {
    expect((await call("POST", "/attendance/holidays", { date: "2026-12-25", name: "Christmas" })).status).toBe(201);
    expect((await call("POST", "/attendance/holidays", { date: "2026-12-25", name: "ക്രിസ്മസ്" })).status).toBe(200);
    expect((await call("GET", "/attendance/holidays?year=2026")).json.holidays).toMatchObject([{ date: "2026-12-25", name: "ക്രിസ്മസ്" }]);
    expect((await call("DELETE", "/attendance/holidays/2026-12-25")).status).toBe(200);
    expect((await call("DELETE", "/attendance/holidays/2026-12-25")).status).toBe(404);
    expect((await call("GET", "/attendance/settings")).json.settings).toEqual({ secondSaturday: true, clPerYear: 20 });
    await call("PUT", "/attendance/settings", { secondSaturday: false, clPerYear: 20 });
    expect((await month("2026-10")).days.find((d) => d.date === "2026-10-10")!.holiday).toBeNull();
    const h = await history();
    expect(h).toContain("Holiday added: 25 Dec 2026, Christmas");
    expect(h).toContain("Holiday removed: 25 Dec 2026, ക്രിസ്മസ്");
    expect(h.some((x) => x.startsWith("Attendance settings saved: second Saturdays aren't holidays"))).toBe(true);
  });
});
