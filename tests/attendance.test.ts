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
import { DEFAULT_ATTENDANCE_SETTINGS, allThreeInAWeek, dutyForOff, fromLastOff, go303Breaks, mondayOf, needsOff, offsInLongAway, offLine, offStatus, offsEarned, monthCounts, addMonths, chExpires, guessChLimit, holidayOn, isSecondSaturday, monthDays, offByItself, shiftMonth, weeklyOff, type WeeklyDay } from "../src/shared/attendance";
import type { AttendanceMonth, AuditEvent, AwayDays, LeaveType, OffsBoard, PersonDays } from "../src/shared/types";
import type { AttendanceSettings, MarkDay } from "../src/shared/attendance";
import { dayLabel } from "../src/shared/reminderSchedule";
import { awayDays, offsReminder, settlePlannedOffs, unmarkedToday } from "../src/server/routes/attendance";
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
    // An off is for weekly-off staff only (Weekly brings one in from the starting figures).
    await call("PUT", "/attendance/settings", { start: { [w]: { asOn: "2026-09-30", clTaken: 0, chOpen: [], offsDue: 1, towards: 0 } } });
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
    expect((await call("GET", "/attendance/settings")).json.settings).toEqual({ secondSaturday: true, clPerYear: 20, chLimits: {}, start: {}, offEvery: 6, maxRun: 12, assumeDuty: false });
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
    await call("PUT", "/attendance/settings", { start: { [w]: { asOn: "2026-08-31", clTaken: 0, chOpen: [], offsDue: 0, towards: 0 } }, assumeDuty: false });
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
    expect(m.weekly).toEqual([{ employeeId: w, countFrom: "2026-09-01", offsDue: 2, towards: 4, run: 2, long: ["2026-09-21"], runBefore: 0, dueBefore: 0, towardsBefore: 0 }]);
    // October starts with the run of 26 Sep carried in (27–30 Sep not marked keep it).
    expect((await month("2026-10")).weekly[0]).toMatchObject({ runBefore: 2 });
    // 7 days earn an off instead of 6.
    await call("PUT", "/attendance/settings", { start: { [w]: { asOn: "2026-08-31", clTaken: 0, chOpen: [], offsDue: 0, towards: 0 } }, offEvery: 7, assumeDuty: false });
    expect((await month("2026-09")).weekly[0]).toMatchObject({ offsDue: 2, towards: 1 });
    // Sunday-off staff have no weekly figures.
    expect(m.weekly.some((x) => x.employeeId === s)).toBe(false);
  });

  it("an off before it is earned is still marked, counted as taken early and paid back by the next one", async () => {
    const w = await add({ name: "Weekly", offDay: "weekly" });
    await call("PUT", "/attendance/settings", { start: { [w]: { asOn: "2026-08-31", clTaken: 0, chOpen: [], offsDue: 0, towards: 0 } }, assumeDuty: false });
    const day = (d: number) => ({ employeeId: w, date: `2026-09-${String(d).padStart(2, "0")}` });
    // 1–3 Sep present and 4 Sep CL: 4 counted; an off on 5 Sep comes 2 days early but is marked (since 2026-11-02).
    await call("POST", "/attendance/mark", { cells: [1, 2, 3].map(day), mark: "present" });
    await call("POST", "/attendance/mark", { cells: [day(4)], mark: "cl" });
    expect((await call("POST", "/attendance/mark", { cells: [day(5)], mark: "off" })).json).toEqual({ marked: 1, skipped: {} });
    let sep = await month("2026-09");
    // 12 Sep, the second Saturday, not worked counts too: 5 towards the next off, a run of 1.
    expect(sep.weekly[0]).toMatchObject({ offsDue: -1, towards: 5, run: 1 });
    // Taken early: the next off needs 7 more days (the 12 days for two offs, less the 5 counted).
    expect(offStatus(sep.weekly[0]!, { offEvery: 6, maxRun: 12 })).toMatchObject({ tone: "grey", early: 1, need: 7, text: "Off after 7 more days" });
    // 6–13 Sep present: 12 counted, one off owed again.
    await call("POST", "/attendance/mark", { cells: [6, 7, 8, 9, 10, 11, 12, 13].map(day), mark: "present" });
    sep = await month("2026-09");
    expect(sep.weekly[0]).toMatchObject({ offsDue: 1, towards: 0, run: 8 });
    expect(offLine(sep.weekly[0]!, 6)).toBe("1 off owed");
    // The check the register's bar runs: days asked for as offs, earned while one is due, else early with the days
    // still to go; an early one counts as an off.
    const r = offsEarned(
      [
        { date: "a", state: "count" },
        { date: "b", state: "off", asked: true, was: "skip" },
        { date: "c", state: "count" },
        { date: "d", state: "off", asked: true, was: "count" },
      ],
      { offsDue: 0, towards: 4 },
      { offEvery: 6 },
    );
    expect(r.ok).toEqual([]);
    expect([...r.refused]).toEqual([
      ["b", 1],
      ["d", 6],
    ]);
    expect(dutyForOff(1, 3, 6)).toBe(0);
    expect(dutyForOff(-1, 2, 6)).toBe(10);
  });

  it("says where a weekly-off person stands: Day N, off due, overdue, the off + compensatory off after 12 days", () => {
    const f = { offEvery: 6, maxRun: 12 };
    expect(offStatus({ offsDue: 0, towards: 4, run: 4 }, f)).toMatchObject({ tone: "grey", text: "Off after 2 more days" });
    expect(offStatus({ offsDue: 0, towards: 5, run: 5 }, f)).toMatchObject({ tone: "blue", text: "Off after 1 more day" });
    expect(offStatus({ offsDue: 1, towards: 0, run: 6 }, f)).toMatchObject({ tone: "amber", text: "Off due" });
    expect(offStatus({ offsDue: 1, towards: 1, run: 7 }, f)).toMatchObject({ tone: "orange", text: "Off overdue" });
    expect(offStatus({ offsDue: 2, towards: 0, run: 12 }, f)).toMatchObject({ tone: "red", text: "Off + compensatory off owed" });
    expect(offStatus({ offsDue: 2, towards: 1, run: 13 }, f)).toMatchObject({ tone: "red", text: "13 days without an off · 2 offs owed" });
    expect([offStatus({ offsDue: 0, towards: 4, run: 4 }, f), offStatus({ offsDue: 1, towards: 0, run: 6 }, f)].map(needsOff)).toEqual([false, true]);
    // 7 days of duty, then an off: 1 day carried, so the next off is due after 5 more (the user's example).
    const seven: WeeklyDay[] = [...Array.from({ length: 7 }, (_, i) => ({ date: `d${i}`, state: "count" as const })), { date: "off", state: "off" }];
    const w = weeklyOff(seven);
    expect(w).toMatchObject({ offsDue: 0, towards: 1, run: 0 });
    expect(offStatus(w, f)).toMatchObject({ need: 5 });
    // A correction sets the figures as on the end of its day.
    expect(weeklyOff([{ date: "a", state: "count" }, { date: "b", state: "count", set: { offsDue: 1, towards: 2, run: 3 } }, { date: "c", state: "count" }])).toMatchObject({ offsDue: 1, towards: 3, run: 4 });
  });

  it("Correct the count sets the figures as on today, Undo takes it back; the Offs board and Home name who needs an off", async () => {
    const w = await add({ name: NAME, offDay: "weekly" });
    const s = await add({ name: "Sunday off" });
    const today = (await call("GET", "/me")).json.today as string;
    const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    // 13 days of duty up to yesterday: past 12 in a row, the off and a compensatory off owed.
    await call("POST", "/attendance/mark", { cells: Array.from({ length: 13 }, (_, i) => ({ employeeId: w, date: shift(i - 13) })), mark: "present" });
    const board = async () => (await call("GET", "/attendance/offs")).json as OffsBoard;
    let b = await board();
    expect(b.sundayOff).toBe(1);
    expect(b.people).toHaveLength(1);
    expect(b.people[0]).toMatchObject({ id: w, run: 13, offsDue: 2, towards: 1, lastOff: null, cl: 0, chLimit: 22 });
    expect(b.people[0]!.days.map((d) => d.date)).toEqual(Array.from({ length: 14 }, (_, i) => shift(i - 13)));
    expect(b.people[0]!.days[13]).toMatchObject({ date: today, mark: null });
    const uid = (await db.select().from(schema.users))[0]!.id;
    expect(await offsReminder(db, uid, today)).toEqual([{ employeeId: w, name: NAME, tone: "red", text: "13 days without an off · 2 offs owed" }]);
    // The office knows better: an off last week wasn't marked.
    const fix = await call("POST", "/attendance/corrections", { employeeId: w, offsDue: 0, towards: 3, run: 3, note: "Off on Sunday not marked" });
    expect(fix.status).toBe(200);
    b = await board();
    expect(b.people[0]).toMatchObject({ run: 3, offsDue: 0, towards: 3 });
    expect(b.people[0]!.corrections).toEqual([{ id: fix.json.id, date: today, offsDue: 0, towards: 3, run: 3, note: "Off on Sunday not marked" }]);
    expect(await offsReminder(db, uid, today)).toEqual([]);
    expect((await history())[0]).toBe(`Attendance: count of ${NAME} corrected to Day 3, no off owed (was Day 13, 2 offs owed). Off on Sunday not marked`);
    // Nothing to correct for Sunday-off staff; days towards the next off stay under the days that earn one.
    expect((await call("POST", "/attendance/corrections", { employeeId: s, offsDue: 0, towards: 0, run: 0 })).status).toBe(400);
    expect((await call("POST", "/attendance/corrections", { employeeId: w, offsDue: 0, towards: 6, run: 0 })).status).toBe(400);
    // Undo: the count from the marks comes back.
    expect((await call("DELETE", `/attendance/corrections/${fix.json.id}`)).status).toBe(200);
    expect((await board()).people[0]).toMatchObject({ run: 13, offsDue: 2, corrections: [] });
    // Off today (earned or not, it is marked): one owed is paid.
    expect((await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: today }], mark: "off", replace: true })).json.marked).toBe(1);
    b = await board();
    expect(b.people[0]).toMatchObject({ run: 0, offsDue: 1, lastOff: today });
    // The month's figures carry corrections in it, for the register's warnings.
    await call("POST", "/attendance/corrections", { employeeId: w, offsDue: 0, towards: 0, run: 0 });
    expect((await month(today.slice(0, 7))).corrections).toEqual([{ employeeId: w, date: today, offsDue: 0, towards: 0, run: 0 }]);
    const userId = (await db.select().from(schema.users))[0]!.id;
    expect(await offsReminder(db, userId, today)).toEqual([]);
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
    // An off due from before the register, so the off on 5 Sep is earned.
    await call("PUT", "/attendance/settings", { start: { [a]: { asOn: "2026-08-31", clTaken: 0, chOpen: [], offsDue: 1, towards: 0 } }, assumeDuty: false });
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
    await call("PUT", "/attendance/settings", { assumeDuty: false });
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
    // Home no longer shows it (attendance on its own page only, 2026-11-02).
    expect((await call("GET", "/summary")).json).not.toHaveProperty("attendanceUnmarked");
    // While days not marked count as duty there is nothing to remind about.
    await call("PUT", "/attendance/settings", { assumeDuty: true });
    expect(await unmarkedToday(db, userId, today, "Asia/Kolkata", at(12))).toBeNull();
  });

  it("the backup brings holidays, marks and settings back into an empty WorkDesk", async () => {
    const a = await add({ name: NAME });
    await call("POST", "/attendance/holidays", { date: "2026-10-02", name: "ഗാന്ധി ജയന്തി" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: a, date: "2026-10-05" }], mark: "cl" });
    await call("PUT", "/attendance/settings", { clPerYear: 15 });
    const w = await add({ name: "Weekly", offDay: "weekly" });
    await call("POST", "/attendance/corrections", { employeeId: w, offsDue: 1, towards: 2, run: 8 });
    const backup = (await call("GET", "/transfer/backup")).json as { tables: Record<string, unknown[]> };
    expect([backup.tables.holidays, backup.tables.attendanceMarks, backup.tables.attendanceSettings, backup.tables.attendanceCorrections].map((t) => t?.length)).toEqual([1, 1, 1, 1]);
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
    for (const t of BACKUP_TABLES) await call("POST", "/transfer/backup", { table: t, rows: backup.tables[t] ?? [] });
    const oct = await month("2026-10");
    expect(oct.days.find((x) => x.date === "2026-10-02")!.holiday).toEqual({ name: "ഗാന്ധി ജയന്തി", kind: "public" });
    expect(markOf(oct, a, "2026-10-05")).toBe("cl");
    expect(oct.settings.clPerYear).toBe(15);
    expect(((await call("GET", "/attendance/offs")).json as OffsBoard).people[0]).toMatchObject({ run: 8, offsDue: 1, towards: 2 });
  });

  it("days not marked count as duty from a starting point; Start the register works out Day N from the last off", async () => {
    const w = await add({ name: NAME, offDay: "weekly" });
    const fresh = await add({ name: "Fresh", offDay: "weekly" });
    const s = await add({ name: "Sunday off" });
    const today = (await call("GET", "/me")).json.today as string;
    const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    const board = async () => (await call("GET", "/attendance/offs")).json as OffsBoard;
    const person = async (id: string) => (await board()).people.find((p) => p.id === id)!;
    // Off to start since 2026-11-02 (the register keeper ticks every day): switched on here.
    await call("PUT", "/attendance/settings", { assumeDuty: true });
    // Nobody has a starting point: nothing is assumed and nobody is reminded.
    expect(await person(w)).toMatchObject({ started: false, run: 0, offsDue: 0 });
    const uid = (await db.select().from(schema.users))[0]!.id;
    expect(await offsReminder(db, uid, today)).toEqual([]);
    // The last off 16 days before the start (as on 3 days ago): 13 days since it, so Day 13 with the off and a
    // compensatory off owed and 1 day towards the next; the 2 days since then count as duty, today not yet.
    expect((await call("POST", "/attendance/start", { asOn: shift(-3), people: [{ employeeId: w, lastOff: shift(-16), clTaken: 1 }, { employeeId: s, clTaken: 2.5 }] })).json).toEqual({ saved: 2 });
    expect(await person(w)).toMatchObject({ started: true, run: 15, offsDue: 2, towards: 3, lastOff: shift(-16) });
    expect(await person(fresh)).toMatchObject({ started: false });
    expect((await offsReminder(db, uid, today)).map((o) => o.employeeId)).toEqual([w]);
    expect((await history())[0]).toBe(`Attendance register started as on ${dayLabel(shift(-3))} for 2 people`);
    const saved = (await call("GET", "/attendance/settings")).json.settings as AttendanceSettings;
    expect(saved.start[w]).toMatchObject({ asOn: shift(-3), run: 13, offsDue: 2, towards: 1, lastOff: shift(-16), clTaken: 1 });
    expect(saved.start[s]).toMatchObject({ run: 0, offsDue: 0, clTaken: 2.5, lastOff: null });
    // An off two days ago: one owed paid, and yesterday (not marked) is Day 1.
    await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: shift(-2) }], mark: "off" });
    expect(await person(w)).toMatchObject({ run: 1, offsDue: 1, towards: 2 });
    // The month counts a past working day not marked as present and none as not marked.
    const m = await month(shift(-1).slice(0, 7));
    expect(monthCounts(m).find((c) => c.employeeId === s)!.notMarked).toBe(0);
    // With every day to be ticked, yesterday counts nothing.
    await call("PUT", "/attendance/settings", { ...saved, assumeDuty: false });
    expect(await person(w)).toMatchObject({ run: 0, offsDue: 1, towards: 1 });
    // Days since the last off instead of its date; a last off after the start is refused.
    expect((await call("POST", "/attendance/start", { asOn: shift(-1), people: [{ employeeId: fresh, days: 7, extraOffs: 1 }] })).json.saved).toBe(1);
    expect(await person(fresh)).toMatchObject({ started: true, run: 7, offsDue: 2, towards: 1 });
    expect((await call("POST", "/attendance/start", { asOn: shift(-5), people: [{ employeeId: fresh, lastOff: shift(-1) }] })).status).toBe(400);
    expect(fromLastOff("2026-10-01", "2026-10-14", 0, 6)).toEqual({ run: 13, towards: 1, offsDue: 2 });
  });

  it("plans an off ahead: refused on a holiday, today or for Sunday-off staff; moved, cancelled, and on its day it becomes an off", async () => {
    const w = await add({ name: NAME, offDay: "weekly" });
    const s = await add({ name: "Sunday off" });
    const today = (await call("GET", "/me")).json.today as string;
    const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    const board = async () => (await call("GET", "/attendance/offs")).json as OffsBoard;
    const person = async () => (await board()).people.find((p) => p.id === w)!;
    await call("POST", "/attendance/holidays", { date: shift(3), name: "Test holiday" });
    const plan = await call("POST", "/attendance/plans", { employeeId: w, date: shift(2), note: "അവധി ചോദിച്ചു" });
    expect(plan.status).toBe(200);
    expect((await person()).planned).toEqual([{ id: plan.json.id, date: shift(2), note: "അവധി ചോദിച്ചു" }]);
    expect((await history())[0]).toBe(`Attendance: off planned for ${NAME} on ${dayLabel(shift(2))}. അവധി ചോദിച്ചു`);
    // Not on a holiday, not today (mark the off instead), not for Sunday-off staff.
    const bad = await call("POST", "/attendance/plans", { employeeId: w, date: shift(3) });
    expect([bad.status, bad.json.error]).toEqual([400, `${dayLabel(shift(3))} is a holiday (Test holiday)`]);
    expect((await call("POST", "/attendance/plans", { employeeId: w, date: today })).status).toBe(400);
    expect((await call("POST", "/attendance/plans", { employeeId: s, date: shift(2) })).status).toBe(400);
    // Moved, shown in the month, cancelled.
    expect((await call("PUT", `/attendance/plans/${plan.json.id}`, { date: shift(4) })).status).toBe(200);
    expect((await person()).planned.map((p) => p.date)).toEqual([shift(4)]);
    expect((await month(shift(4).slice(0, 7))).planned).toEqual([{ id: plan.json.id, employeeId: w, date: shift(4), note: "അവധി ചോദിച്ചു" }]);
    expect((await call("PUT", `/attendance/plans/${plan.json.id}`, { date: shift(3) })).status).toBe(400);
    expect((await call("DELETE", `/attendance/plans/${plan.json.id}`)).json).toMatchObject({ ok: true, date: shift(4) });
    expect((await person()).planned).toEqual([]);
    // On its day a plan becomes an off; one on a day already marked is dropped.
    const userId = (await db.select().from(schema.users))[0]!.id;
    await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: shift(-1) }], mark: "present" });
    await db.insert(schema.plannedOffs).values([
      { userId, employeeId: w, date: today },
      { userId, employeeId: w, date: shift(-1) },
    ]);
    const p = await person();
    expect(p.planned).toEqual([]);
    expect(p.days.find((d) => d.date === today)!.mark).toBe("off");
    expect(p.days.find((d) => d.date === shift(-1))!.mark).toBe("present");
    expect((await history())[0]).toBe(`Attendance: planned off marked: ${NAME} (${dayLabel(today)}); 1 not marked (that day already marked, leave or a holiday)`);
    expect(await settlePlannedOffs(db, userId, today)).toBe(0);
  });

  it("Person days: a person's three weeks from a Monday, with their marks, leave, holidays, planned offs and figures", async () => {
    const w = await add({ name: NAME, offDay: "weekly" });
    const s = await add({ name: "Sunday off" });
    const today = (await call("GET", "/me")).json.today as string;
    const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    const monday = mondayOf(today);
    // Off tomorrow, CL the day after: future days take marks straight away.
    await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: shift(1) }], mark: "off" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: shift(2) }], mark: "cl" });
    await call("POST", "/attendance/holidays", { date: shift(3), name: "Test holiday" });
    await call("POST", "/attendance/plans", { employeeId: w, date: shift(5) });
    const p = (await call("GET", `/attendance/person/${w}`)).json as PersonDays;
    expect([p.from, p.to, p.days.length]).toEqual([monday, new Date(Date.parse(`${monday}T00:00:00Z`) + 20 * 86400_000).toISOString().slice(0, 10), 21]);
    const dayOf = (d: string) => p.days.find((x) => x.date === d)!;
    expect(dayOf(shift(1))).toMatchObject({ mark: "off", holiday: null, out: false });
    expect(dayOf(shift(2)).mark).toBe("cl");
    expect(dayOf(shift(3)).holiday).toBe("Test holiday");
    expect(dayOf(shift(5))).toMatchObject({ planned: true, mark: null });
    expect(p).toMatchObject({ employee: { id: w, offDay: "weekly" }, cl: shift(2).slice(0, 4) === today.slice(0, 4) ? 1 : 0, settings: { assumeDuty: false, offEvery: 6 } });
    expect(p.weekly).not.toBeNull();
    // ?from= moves to its Monday; Sunday-off staff have Sundays as holidays and no weekly figures.
    const later = (await call("GET", `/attendance/person/${s}?from=${shift(9)}`)).json as PersonDays;
    expect(later.from).toBe(mondayOf(shift(9)));
    expect(later.days[6]).toMatchObject({ weekday: 0, holiday: "Sunday" });
    expect(later.weekly).toBeNull();
    expect((await call("GET", "/attendance/person/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
  });

  it("away today and tomorrow: offs, CL, CH, absences, leave and planned offs", async () => {
    const w = await add({ name: NAME, offDay: "weekly" });
    const s = await add({ name: "Biju" });
    const x = await add({ name: "Nobody away" });
    const today = (await call("GET", "/me")).json.today as string;
    const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    await call("POST", "/attendance/mark", { cells: [{ employeeId: w, date: today }], mark: "off" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: s, date: today }], mark: "cl_half" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: s, date: shift(1) }], mark: "cl" });
    await call("POST", "/attendance/plans", { employeeId: w, date: shift(1) });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: x, date: today }], mark: "present" });
    const away = (await call("GET", "/attendance/away")).json as AwayDays;
    expect(away.days.map((d) => d.date)).toEqual([today, shift(1)]);
    const said = (i: number) => away.days[i]!.people.map((p) => `${p.name}: ${p.what}`).sort();
    expect(said(0)).toEqual([`${NAME}: Off`, "Biju: ½ CL"].sort());
    expect(said(1)).toEqual([`${NAME}: Off (planned)`, "Biju: CL"].sort());
    expect(away.chLapsing).toEqual([]);
    const uid = (await db.select().from(schema.users))[0]!.id;
    expect((await awayDays(db, uid, today)).days.map((d) => d.people.length)).toEqual([2, 2]);
  });

  it("G.O.(Ms) 303/82/HSD: no off after a week away on CL, CH and offs; not CL, CH and an off all in one week", () => {
    // 2–8 Nov 2026 is Monday to Sunday.
    const d = (day: number, mark: MarkDay["mark"], holiday = false): MarkDay => ({ date: `2026-11-${String(day).padStart(2, "0")}`, mark, holiday });
    // CL 2–4, CH 5, off 6, CL 7–8: seven days away in a row, so the off on 6 Nov is not due; 6 days would be fine.
    const week = [d(1, "present"), d(2, "cl"), d(3, "cl"), d(4, "cl"), d(5, "ch"), d(6, "off"), d(7, "cl"), d(8, "cl"), d(9, "present")];
    expect(offsInLongAway(week)).toEqual(["2026-11-06"]);
    expect(offsInLongAway(week.map((x) => (x.date === "2026-11-08" ? { ...x, mark: "present" as const } : x)))).toEqual([]);
    // A holiday not worked joins the stretch; a day of duty breaks it.
    expect(offsInLongAway([d(2, "cl"), d(3, "cl"), d(4, null, true), d(5, "cl"), d(6, "off"), d(7, "ch"), d(8, "cl")])).toEqual(["2026-11-06"]);
    // CL, CH and an off in the same Monday–Sunday week; CL with an off, or an off with CH, is allowed.
    expect(allThreeInAWeek(week)).toEqual(["2026-11-02"]);
    expect(allThreeInAWeek([d(2, "cl"), d(6, "off")])).toEqual([]);
    expect(allThreeInAWeek([d(2, "cl_half"), d(4, "ch"), d(8, "off")])).toEqual(["2026-11-02"]);
    // Across two weeks (Sunday 8 and Monday 9) it is not one week.
    expect(allThreeInAWeek([d(7, "cl"), d(8, "ch"), d(9, "off")])).toEqual([]);
    // What a new mark would break: only what it adds, and holidays keep their own state.
    const before = [d(2, "cl"), d(3, "present"), d(4, "ch"), d(5, "present")];
    expect(go303Breaks(before, new Set(["2026-11-05"]), "off")).toEqual({ offInLongAway: [], threeInWeek: ["2026-11-02"] });
    expect(go303Breaks(before, new Set(["2026-11-05"]), "cl")).toEqual({ offInLongAway: [], threeInWeek: [] });
  });
});
