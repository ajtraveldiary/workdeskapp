// Attendance register (user request 2026-10-31, docs/ATTENDANCE_PLAN.md). Phase 1: the month as the register shows
// it, marking a day for everyone in one go and chosen cells, what is left out (leave, holidays, not in the office,
// other marks), clearing, the year's CL total, holidays and second Saturdays, and the settings. Phase 2: CH tied to
// a holiday worked (3 months, once each), CH limits by post, starting figures, and weekly-off counting.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { DEFAULT_ATTENDANCE_SETTINGS, monthCounts, addMonths, chExpires, guessChLimit, holidayOn, isSecondSaturday, monthDays, offByItself, shiftMonth, weeklyOff, type WeeklyDay } from "../src/shared/attendance";
import type { AttendanceMonth, AuditEvent, LeaveType } from "../src/shared/types";
import { unmarkedToday } from "../src/server/routes/attendance";
import { BACKUP_TABLES } from "../src/shared/transfer";

const NAME = "2026-27 സാമ്പത്തിക വർഷത്തെ ജൂനിയർ ഹെൽത്ത് ഇൻസ്‌പെക്ടർ ശ്രീമതി അനിതാകുമാരി രാധാകൃഷ്ണൻ";

describe("attendance register", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
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
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("works out the month's days, second Saturdays and which days are off by themselves", () => {
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2028-02")).toHaveLength(29);
    expect(monthDays("2026-10")[30]).toBe("2026-10-31");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(["2026-10-10", "2026-10-03", "2026-10-17", "2026-11-14"].map(isSecondSaturday)).toEqual([true, false, false, true]);
    const on = DEFAULT_ATTENDANCE_SETTINGS;
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
    expect((await call("GET", "/attendance/settings")).json.settings).toEqual({ secondSaturday: true, clPerYear: 20, chLimits: {}, start: {}, offEvery: 6, maxRun: 12 });
    await call("PUT", "/attendance/settings", { secondSaturday: false, clPerYear: 20 });
    expect((await month("2026-10")).days.find((d) => d.date === "2026-10-10")!.holiday).toBeNull();
    const h = await history();
    expect(h).toContain("Holiday added: 25 Dec 2026, Christmas");
    expect(h).toContain("Holiday removed: 25 Dec 2026, ക്രിസ്മസ്");
    expect(h.some((x) => x.startsWith("Attendance settings saved: second Saturdays aren't holidays"))).toBe(true);
  });

  // --- Phase 2 ---

  it("works out CH expiry, CH limits by post and weekly-off counting", () => {
    expect([addMonths("2026-11-30", 3), chExpires("2026-10-02"), addMonths("2026-01-31", 1)]).toEqual(["2027-02-28", "2027-01-02", "2026-02-28"]);
    expect(["Staff Nurse Grade II", "Nursing Officer", "Nursing Assistant", "Hospital Attendant Grade I", "Junior Health Inspector", null].map(guessChLimit)).toEqual([null, null, 45, 45, 22, 22]);
    const days = (states: WeeklyDay["state"][]) => states.map((state, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, state }));
    // The user's example: 7 days, an off, then 5 more days earn the next off.
    expect(weeklyOff(days([...Array(7).fill("count"), "off", ...Array(5).fill("count")]))).toMatchObject({ offsDue: 1, towards: 0, run: 5 });
    // Regular leave starts the run again; days not marked keep it; more than 12 in a row are warned about.
    const w = weeklyOff(days([...Array(10).fill("count"), "skip", ...Array(3).fill("count"), "reset", "count"]));
    expect(w).toMatchObject({ offsDue: 2, towards: 2, run: 1, long: ["2026-09-14"] });
    expect(weeklyOff([], { offsDue: 2, towards: 4 })).toEqual({ offsDue: 2, towards: 4, run: 0, long: [] });
    // Other figures from Settings, and a run carried in from before.
    expect(weeklyOff(days(Array(5).fill("count")), undefined, { offEvery: 5, maxRun: 6 }, 3)).toMatchObject({ offsDue: 1, towards: 0, run: 8, long: ["2026-09-04", "2026-09-05"] });
  });

  it("CH: earned by a holiday worked (not a Sunday), taken once within 3 months, tied to its holiday", async () => {
    const a = await add({ name: NAME });
    await call("POST", "/attendance/holidays", { date: "2026-10-02", name: "Gandhi Jayanthi" });
    // Holiday duty on 2 Oct and the second Saturday (10 Oct); a Sunday worked (4 Oct) earns nothing.
    await call("POST", "/attendance/mark", { cells: ["2026-10-02", "2026-10-04", "2026-10-10"].map((date) => ({ employeeId: a, date })), mark: "present" });
    const oct = await month("2026-10");
    expect(oct.chOpen).toEqual([
      { employeeId: a, holiday: "2026-10-02", name: "Gandhi Jayanthi", expires: "2027-01-02" },
      { employeeId: a, holiday: "2026-10-10", name: "Second Saturday", expires: "2027-01-10" },
    ]);
    const ch = (items: { date: string; holiday: string }[]) => call("POST", "/attendance/ch", { items: items.map((i) => ({ employeeId: a, ...i })) });
    expect((await ch([{ date: "2026-10-05", holiday: "2026-10-02" }])).json).toEqual({ marked: 1, skipped: {} });
    // Not again for the same holiday, not before it, not on a holiday, not after 3 months.
    expect((await ch([{ date: "2026-10-06", holiday: "2026-10-02" }])).json.skipped).toEqual({ "no holiday worked to take it for": 1 });
    expect((await ch([{ date: "2026-10-09", holiday: "2026-10-10" }])).json.skipped).toEqual({ "no holiday worked to take it for": 1 });
    expect((await ch([{ date: "2026-10-11", holiday: "2026-10-10" }])).json.skipped).toEqual({ holiday: 1 });
    expect((await ch([{ date: "2027-01-11", holiday: "2026-10-10" }])).json.skipped).toEqual({ "no holiday worked to take it for": 1 });
    const after = await month("2026-10");
    expect(after.chOpen.map((o) => o.holiday)).toEqual(["2026-10-10"]);
    expect(after.chFor).toEqual([{ employeeId: a, date: "2026-10-05", holiday: "2026-10-02" }]);
    expect(after.totals[0]).toMatchObject({ ch: 1 });
    expect(markOf(after, a, "2026-10-05")).toBe("ch");
    // The holiday worked keeps its mark while its CH is there.
    expect((await call("POST", "/attendance/clear", { cells: [{ employeeId: a, date: "2026-10-02" }] })).json).toEqual({ cleared: 0, kept: 1 });
    await call("POST", "/attendance/clear", { cells: [{ employeeId: a, date: "2026-10-05" }] });
    expect((await month("2026-10")).chOpen.map((o) => o.holiday)).toEqual(["2026-10-02", "2026-10-10"]);
    expect(await history()).toContain(`Attendance 5 Oct 2026: CH for ${NAME}, for the holiday worked on 2 Oct 2026`);
  });

  it("starting figures add CL taken and holidays worked before the register; CH limits follow Settings, else the post", async () => {
    const nurse = (await call("POST", "/staff/designations", { name: "Staff Nurse" })).json.id as string;
    const clerk = (await call("POST", "/staff/designations", { name: "Clerk" })).json.id as string;
    const a = await add({ name: NAME, designationId: clerk });
    const n = await add({ name: "Nurse", designationId: nurse });
    await call("PUT", "/attendance/settings", {
      secondSaturday: true,
      clPerYear: 20,
      chLimits: { [clerk]: 15 },
      start: { [a]: { asOn: "2026-09-30", clTaken: 3.5, chOpen: [{ date: "2026-09-15", name: "Onam" }], offsDue: 0, towards: 0 } },
    });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-10-05" }], mark: "cl" });
    const oct = await month("2026-10");
    expect(oct.totals.find((t) => t.employeeId === a)).toEqual({ employeeId: a, cl: 4.5, ch: 0 });
    expect(oct.chOpen).toEqual([{ employeeId: a, holiday: "2026-09-15", name: "Onam", expires: "2026-12-15" }]);
    expect(oct.chLimits).toEqual(expect.arrayContaining([{ employeeId: a, limit: 15 }, { employeeId: n, limit: null }]));
    expect((await call("POST", "/attendance/ch", { items: [{ employeeId: a, date: "2026-10-06", holiday: "2026-09-15" }] })).json.marked).toBe(1);
    // The starting CL counts only in its own year.
    expect((await month("2027-01")).totals.find((t) => t.employeeId === a)!.cl).toBe(0);
  });

  it("weekly-off staff: 6 counted days earn an off, offs taken come off, more than 12 in a row is flagged", async () => {
    const w = await add({ name: "Weekly", offDay: "weekly" });
    const s = await add({ name: "Sunday off" });
    await call("PUT", "/attendance/settings", { start: { [w]: { asOn: "2026-08-31", clTaken: 0, chOpen: [], offsDue: 0, towards: 0 } } });
    const sep = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ employeeId: w, date: `2026-09-${String(from + i).padStart(2, "0")}` }));
    // 1–7 Sep counted (6 Sep is a Sunday, worked), an off on 8 Sep, then 13 days in a row (12 Sep, the second
    // Saturday, worked) with one of them CL.
    await call("POST", "/attendance/mark", { cells: sep(1, 7), mark: "present" });
    await call("POST", "/attendance/mark", { cells: sep(8, 8), mark: "off" });
    await call("POST", "/attendance/mark", { cells: sep(9, 21), mark: "present" });
    await call("POST", "/attendance/mark", { cells: sep(15, 15), mark: "cl", replace: true });
    // HPL from the Leave page on 23–24 Sep starts the run again.
    const hpl = ((await call("GET", "/leave/types")).json.types as LeaveType[]).find((t) => t.short === "HPL")!;
    await call("POST", `/leave/accounts/${w}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    await call("POST", "/leave/leaves", { employeeId: w, typeId: hpl.id, fromDate: "2026-09-23", toDate: "2026-09-24", days: 2 });
    await call("POST", "/attendance/mark", { cells: sep(25, 26), mark: "present" });
    const m = await month("2026-09");
    // Counted: 7 + 13 + 2 = 22 → 3 offs earned, 1 taken; 4 towards the next. The run is 2 since the leave.
    expect(m.weekly).toEqual([{ employeeId: w, offsDue: 2, towards: 4, run: 2, long: ["2026-09-21"], runBefore: 0 }]);
    // October starts with the run of 26 Sep carried in (27–30 Sep not marked keep it).
    expect((await month("2026-10")).weekly[0]).toMatchObject({ runBefore: 2 });
    // 7 days earn an off instead of 6.
    await call("PUT", "/attendance/settings", { start: { [w]: { asOn: "2026-08-31", clTaken: 0, chOpen: [], offsDue: 0, towards: 0 } }, offEvery: 7 });
    expect((await month("2026-09")).weekly[0]).toMatchObject({ offsDue: 2, towards: 1 });
    // Sunday-off staff have no weekly figures.
    expect(m.weekly.some((x) => x.employeeId === s)).toBe(false);
  });

  it("a run of CL / CH with holidays is seen across the month's edges", async () => {
    const a = await add({ name: NAME });
    // 25 Sep (Fri) CL, 26–27 Sep the weekend's Sunday and a holiday, 28–30 Sep CL; 1–2 Nov CL.
    await call("POST", "/attendance/holidays", { date: "2026-09-26", name: "Local holiday" });
    await call("POST", "/attendance/mark", { cells: ["2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-11-02"].map((date) => ({ employeeId: a, date })), mark: "cl" });
    // Before October: 25–30 Sep (6 days). After it: 1 Nov (a Sunday) and 2 Nov (CL); the register adds them only
    // when October's last days are part of the run.
    const oct = await month("2026-10");
    expect(oct.edges).toEqual([{ employeeId: a, before: 6, after: 2 }]);
    // Present on 30 Sep breaks it.
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-09-30" }], mark: "present", replace: true });
    expect((await month("2026-10")).edges[0]!.before).toBe(0);
  });

  it("starting figures come from a CSV and go out to one", async () => {
    const a = await add({ name: NAME, pen: "765432" });
    const w = await add({ name: "Weekly", offDay: "weekly" });
    const imp = await call("POST", "/transfer/attendance/import", {
      headers: ["PEN", "Name", "As on", "CL taken", "Holidays worked, CH to take", "Offs due", "Days towards the next off"],
      rows: [
        ["765432", "", "30/09/2026", "4.5", "2026-09-15 തിരുവോണം; 2026-09-26", "", ""],
        ["", "Weekly", "2026-09-30", "1", "", "2", "3"],
        ["", "Nobody", "2026-09-30", "", "", "", ""],
        ["", "Weekly", "2026-09-30", "", "", "", ""],
        ["", "Bad holiday", "2026-09-30", "", "Onam", "", ""],
      ],
      firstLine: 2,
      dryRun: false,
    });
    expect(imp.json).toMatchObject({ added: 2, updated: 0 });
    expect(imp.json.problems).toHaveLength(3);
    const settings = (await call("GET", "/attendance/settings")).json.settings;
    expect(settings.start[a]).toEqual({ asOn: "2026-09-30", clTaken: 4.5, chOpen: [{ date: "2026-09-15", name: "തിരുവോണം" }, { date: "2026-09-26", name: "" }], offsDue: 0, towards: 0 });
    expect(settings.start[w]).toMatchObject({ offsDue: 2, towards: 3, clTaken: 1 });
    expect(await history()).toContain("Attendance starting figures from a file: 2 people");
    const csv = await (await app.request("/api/transfer/attendance/csv", {}, {})).text();
    expect(csv).toContain("765432");
    expect(csv).toContain("2026-09-15 തിരുവോണം; 2026-09-26");
  });

  // --- Phase 3 ---

  it("sums up a person's month: present, holiday duty, CL with halves, CH, offs, absent, leave, not marked", async () => {
    const a = await add({ name: NAME, offDay: "weekly" });
    await call("POST", "/attendance/holidays", { date: "2026-09-15", name: "Onam" });
    await call("POST", "/attendance/mark", { cells: ["2026-09-01", "2026-09-02", "2026-09-15"].map((date) => ({ employeeId: a, date })), mark: "present" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-09-03" }], mark: "cl" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-09-04" }], mark: "cl_half" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-09-05" }], mark: "off" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-09-07" }], mark: "absent" });
    await call("POST", "/attendance/ch", { items: [{ employeeId: a, date: "2026-09-08", holiday: "2026-09-15" }] });
    await call("POST", "/attendance/ch", { items: [{ employeeId: a, date: "2026-09-16", holiday: "2026-09-15" }] });
    const sep = await month("2026-09");
    // 30 days: 8 marked (the second CH for the same holiday was left out), the second Saturday (12 Sep) not marked
    // is a holiday; every other day not marked is counted (weekly-off staff work Sundays).
    expect(monthCounts(sep)[0]).toEqual({ employeeId: a, present: 2, holidayDuty: 1, cl: 1.5, ch: 1, off: 1, absent: 1, leave: 0, notMarked: 30 - 8 - 1 });
  });

  it("Home's reminder: from 11 am, people in the office not marked today, only when the register is kept", async () => {
    const a = await add({ name: NAME });
    const b = await add({ name: "Biju" });
    const today = (await call("GET", "/me")).json.today as string;
    const at = (h: number) => new Date(`${today}T${String(h).padStart(2, "0")}:30:00+05:30`);
    const userId = (await db.select().from(schema.users))[0]!.id;
    // Not kept yet: no marks in the last 30 days.
    expect(await unmarkedToday(db, userId, today, "Asia/Kolkata", at(12))).toBeNull();
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: yesterday }], mark: "present", replace: true });
    expect(await unmarkedToday(db, userId, today, "Asia/Kolkata", at(10))).toBeNull();
    const before = await unmarkedToday(db, userId, today, "Asia/Kolkata", at(12));
    await call("POST", "/attendance/mark", { cells: [{ employeeId: b, date: today }], mark: "present" });
    const after = await unmarkedToday(db, userId, today, "Asia/Kolkata", at(12));
    // On a holiday or a Sunday nobody is due (0); otherwise marking Biju leaves one fewer.
    expect(before === 0 ? after : before! - 1).toBe(after);
    expect((await call("GET", "/summary")).json).toHaveProperty("attendanceUnmarked");
  });

  it("the backup brings holidays, marks and settings back into an empty WorkDesk", async () => {
    const a = await add({ name: NAME });
    await call("POST", "/attendance/holidays", { date: "2026-10-02", name: "ഗാന്ധി ജയന്തി" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-10-05" }], mark: "cl" });
    await call("PUT", "/attendance/settings", { clPerYear: 15 });
    const backup = (await call("GET", "/transfer/backup")).json as { tables: Record<string, unknown[]> };
    expect([backup.tables.holidays, backup.tables.attendanceMarks, backup.tables.attendanceSettings].map((t) => t?.length)).toEqual([1, 1, 1]);
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
    for (const t of BACKUP_TABLES) await call("POST", "/transfer/backup", { table: t, rows: backup.tables[t] ?? [] });
    const oct = await month("2026-10");
    expect(oct.days.find((x) => x.date === "2026-10-02")!.holiday).toEqual({ name: "ഗാന്ധി ജയന്തി", kind: "public" });
    expect(markOf(oct, a, "2026-10-05")).toBe("cl");
    expect(oct.settings.clPerYear).toBe(15);
  });
});
