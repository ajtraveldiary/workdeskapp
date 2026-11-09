// Mark leave pop-up (user request 2026-11-08, docs/ATTENDANCE_MARK_LEAVE_PLAN.md phase 1): one person's days to a
// later day (`?from=&until=`), working days counted from a date (holidays, second Saturdays and Sunday-off staff's
// Sundays skipped; weekly-off staff work Sundays), and the rule warnings shared with Person days (every one listed,
// CH past the post's limit).
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { AttendanceMonth, PersonDay, PersonDays } from "../src/shared/types";
import type { AttendanceSettings } from "../src/shared/attendance";
import { cellWarnings, markWarnings, prefixSuffix, workingDays, type RegisterDay } from "../src/shared/markWarnings";

const NAME = "2026-27 സാമ്പത്തിക വർഷത്തെ ജൂനിയർ ഹെൽത്ത് ഇൻസ്‌പെക്ടർ ശ്രീമതി അനിതാകുമാരി രാധാകൃഷ്ണൻ";
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

describe("Mark leave", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const add = async (body: Record<string, unknown>) => (await call("POST", "/staff/employees", body)).json.id as string;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    const db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("gives a person's days on to `until` (at most 70 days from the Monday) and counts working days", async () => {
    const s = await add({ name: NAME });
    const w = await add({ name: "Weekly", offDay: "weekly" });
    // Fri 13 Nov 2026; Sat 14 is the second Saturday; a holiday on Wed 18.
    await call("POST", "/attendance/holidays", { date: "2026-11-18", name: "Test holiday" });
    const days = async (id: string, q: string) => (await call("GET", `/attendance/person/${id}?${q}`)).json as PersonDays;
    const p = await days(s, "from=2026-11-13&until=2026-12-31");
    expect([p.from, p.to]).toEqual(["2026-11-09", "2026-12-31"]);
    expect((await days(s, "from=2026-11-13&until=2027-06-01")).to).toBe(shift("2026-11-09", 69));
    // An `until` inside the usual three weeks keeps the three weeks.
    expect((await days(s, "from=2026-11-13&until=2026-11-14")).days.length).toBe(21);

    // Sunday-off staff: 4 days of CL from Friday skip the second Saturday, Sunday and the holiday.
    expect(workingDays(p, "2026-11-13", 4, null)).toEqual({
      dates: ["2026-11-13", "2026-11-16", "2026-11-17", "2026-11-19"],
      skipped: [
        { date: "2026-11-14", why: "Second Saturday" },
        { date: "2026-11-15", why: "Sunday" },
        { date: "2026-11-18", why: "Test holiday" },
      ],
    });
    // To a last day instead: every working day from–to.
    expect(workingDays(p, "2026-11-13", null, "2026-11-16").dates).toEqual(["2026-11-13", "2026-11-16"]);
    // Weekly-off staff work Sundays.
    const q = await days(w, "from=2026-11-13&until=2026-12-31");
    expect(workingDays(q, "2026-11-13", 3, null).dates).toEqual(["2026-11-13", "2026-11-15", "2026-11-16"]);
    // Leave from the Leave page is skipped and named.
    const leave = { ...p, days: p.days.map((d) => (d.date === "2026-11-16" ? { ...d, leave: "EL" } : d)) };
    expect(workingDays(leave, "2026-11-13", 2, null)).toMatchObject({ dates: ["2026-11-13", "2026-11-17"], skipped: [{ date: "2026-11-14" }, { date: "2026-11-15" }, { date: "2026-11-16", why: "on EL" }] });
  });

  it("phase 2: holidays prefixed and suffixed to a leave", async () => {
    const s = await add({ name: NAME });
    const w = await add({ name: "Weekly", offDay: "weekly" });
    // Mon 16 – Tue 17 Nov 2026: Sat 14 (second Saturday) and Sun 15 before, a holiday on Wed 18 after.
    await call("POST", "/attendance/holidays", { date: "2026-11-18", name: "Test holiday" });
    const days = async (id: string) => (await call("GET", `/attendance/person/${id}?from=2026-11-09&until=2026-12-31`)).json as PersonDays;
    const p = await days(s);
    expect(prefixSuffix(p, "2026-11-16", "2026-11-17")).toEqual({
      prefix: [
        { date: "2026-11-14", name: "Second Saturday" },
        { date: "2026-11-15", name: "Sunday" },
      ],
      suffix: [{ date: "2026-11-18", name: "Test holiday" }],
    });
    // Weekly-off staff: Sunday is a working day, so only nothing before; a holiday worked is no prefix.
    const q = await days(w);
    expect(prefixSuffix(q, "2026-11-16", "2026-11-17").prefix).toEqual([]);
    const worked = { ...p, days: p.days.map((d) => (d.date === "2026-11-15" ? { ...d, mark: "present" as const } : d)) };
    expect(prefixSuffix(worked, "2026-11-16", "2026-11-17").prefix).toEqual([]);
    // Leave marked from the pop-up: the Leave page's own route, with "Mark in attendance" ticked.
    await call("POST", "/leave/types/usual");
    const el = ((await call("GET", "/leave/types")).json.types as { id: string; ksrKey: string | null }[]).find((t) => t.ksrKey === "el")!;
    const r = await call("POST", "/leave/leaves", { employeeId: s, typeId: el.id, fromDate: "2026-11-16", toDate: "2026-11-17", days: 2, notes: "Prefix: 14.11.2026 (Second Saturday)", doneSteps: ["attendance"] });
    expect(r.status).toBe(201);
    const task = ((await call("GET", "/tasks?view=any")).json.tasks as { id: string; checklist: { id: string; done: boolean }[] }[]).find((t) => t.id === r.json.taskId)!;
    expect(task.checklist.find((x) => x.id === "attendance")!.done).toBe(true);
    expect((await days(s)).days.find((d) => d.date === "2026-11-16")!.leave).toBe("EL");
  });

  it("Edit figures: a person's figures as on a day carry over, and marks up to that day aren't counted again", async () => {
    const s = await add({ name: NAME });
    const w = await add({ name: "Weekly", offDay: "weekly" });
    // A CL and a CH in October, before the figures' date: the figures already hold them.
    await call("POST", "/attendance/mark", { cells: [{ employeeId: s, date: "2026-10-20" }], mark: "cl" });
    await call("POST", "/attendance/mark", { cells: [{ employeeId: s, date: "2026-11-03" }], mark: "cl" });
    const put = (id: string, body: unknown) => call("PUT", `/attendance/start/${id}`, body);
    expect((await put(s, { asOn: "2026-10-31", clTaken: 5, chTaken: 2, chOpen: [{ date: "2026-10-02", name: "Gandhi Jayanthi" }], offsDue: 3, towards: 4, run: 9 })).status).toBe(200);
    const nov = (await call("GET", "/attendance?month=2026-11")).json as AttendanceMonth;
    // CL 5 from the figures + the November CL; the October one isn't counted again. CH 2.
    expect(nov.totals.find((t) => t.employeeId === s)).toMatchObject({ cl: 6, ch: 2 });
    expect(nov.chOpen.filter((o) => o.employeeId === s).map((o) => o.holiday)).toEqual(["2026-10-02"]);
    // Sunday-off staff keep no weekly-off figures.
    const saved = (await call("GET", "/attendance/settings")).json.settings as AttendanceSettings;
    expect(saved.start[s]).toMatchObject({ offsDue: 0, towards: 0, chTaken: 2, chOpen: [{ date: "2026-10-02" }] });
    expect(saved.start[s]!.run).toBeUndefined();
    // Weekly-off staff: offs owed, days carried and Day N carry over.
    await put(w, { asOn: "2026-10-31", clTaken: 0, chOpen: [], offsDue: 1, towards: 2, run: 8 });
    const weekly = nov.weekly.find((x) => x.employeeId === w);
    const again = ((await call("GET", "/attendance?month=2026-11")).json as AttendanceMonth).weekly.find((x) => x.employeeId === w)!;
    expect(weekly === undefined || weekly.dueBefore !== 1).toBe(true);
    expect([again.dueBefore, again.towardsBefore, again.runBefore]).toEqual([1, 2, 8]);
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((e) => e.summary);
    expect(history[0]).toBe("Attendance: figures of Weekly as on 31.10.2026: CL 0, CH 0 taken, 0 CH to take, 1 offs owed, 2 days carried, Day 8");
    expect(history[1]).toContain(`figures of ${NAME} as on 31.10.2026: CL 5, CH 2 taken, 1 CH to take`);
    expect((await put("00000000-0000-4000-8000-000000000000", { asOn: "2026-10-31" })).status).toBe(404);
  });

  // A made-up person for the warnings: days from Mon 2 Nov 2026.
  const person = (over: Partial<PersonDays>, marks: Record<string, PersonDay["mark"]> = {}, extra: Record<string, Partial<PersonDay>> = {}): PersonDays => ({
    today: "2026-11-02",
    from: "2026-11-02",
    to: "2026-11-22",
    settings: { offEvery: 6, maxRun: 12, clPerYear: 20, assumeDuty: false },
    employee: { id: "e", name: NAME, designation: null, offDay: "sunday", permanent: true },
    days: Array.from({ length: 21 }, (_, i) => {
      const date = shift("2026-11-02", i);
      const weekday = (i + 1) % 7;
      return { date, weekday, holiday: over.employee?.offDay !== "weekly" && weekday === 0 ? "Sunday" : null, mark: marks[date] ?? null, note: "", chHoliday: null, leave: null, out: false, planned: false, ...extra[date] };
    }),
    weekly: null,
    lastOff: null,
    cl: 0,
    ch: 0,
    chLimit: 22,
    chOpen: [],
    edges: { before: 0, after: 0 },
    ...over,
  });

  it("lists every warning that applies, with its rule", () => {
    // CL past the year and next to leave: both listed (one used to replace the other).
    const p = person({ cl: 19 }, {}, { "2026-11-06": { leave: "EL" } });
    const cl = markWarnings(p, new Set(["2026-11-04", "2026-11-05"])).cl!;
    expect(cl.map((w) => w.short)).toEqual(["21 of 20 CL", "next to leave"]);
    expect(cl[0]!.rule).toContain("KSR");
    // CH past the post's limit, and no holiday worked open.
    const ch = markWarnings(person({ ch: 22 }), new Set(["2026-11-04"])).ch!;
    expect(ch.map((w) => w.short)).toEqual(["23 of 22 CH", "no holiday worked open"]);
    expect(markWarnings(person({ ch: 3, chLimit: null }), new Set(["2026-11-04"])).ch!.map((w) => w.short)).toEqual(["no holiday worked open"]);
    // Holidays chosen alone warn of nothing.
    expect(markWarnings(person({ cl: 25 }), new Set(["2026-11-08"]))).toEqual({});
    // An off before it is earned: 3 days of duty, then an off, 3 more days needed.
    const weekly = person(
      { employee: { id: "e", name: NAME, designation: null, offDay: "weekly", permanent: true }, weekly: { countFrom: "2026-11-02", offsDue: 0, towards: 0, run: 0, dueBefore: 0, towardsBefore: 0, runBefore: 0, owedSince: [] } },
      { "2026-11-02": "present", "2026-11-03": "present", "2026-11-04": "present" },
    );
    const off = markWarnings(weekly, new Set(["2026-11-05"])).off!;
    expect(off[0]).toMatchObject({ short: "3 days early" });
    expect(off[0]!.text).toContain("3 more days");
  });

  it("cell warnings: what is wrong with marks already in the register (they are saved all the same)", () => {
    // Mon 2 – Sun 15 Nov 2026; Sundays off for Sunday-off staff; a register holiday on Wed 4.
    const days = (offDay: "sunday" | "weekly", marks: Record<number, RegisterDay["mark"]>, extra: Record<number, Partial<RegisterDay>> = {}): RegisterDay[] =>
      Array.from({ length: 14 }, (_, i) => {
        const date = shift("2026-11-02", i);
        const sunday = (i + 1) % 7 === 0;
        const registerHoliday = i === 2;
        return { date, mark: marks[i + 2] ?? null, chHoliday: null, holiday: registerHoliday || (offDay === "sunday" && sunday), registerHoliday, leave: false, out: false, ...extra[i + 2] };
      });
    const settings = { offEvery: 6, maxRun: 12, clPerYear: 20 };
    const base = { settings, clBefore: 0, chBefore: 0, chLimit: 22 };
    // Sunday-off staff: CL on the holiday and on Sunday, an off, H on a working day, a CH with no holiday worked.
    const s = cellWarnings({ ...base, offDay: "sunday", days: days("sunday", { 4: "cl", 8: "cl", 9: "off", 10: "holiday", 11: "ch" }) });
    expect(s.get("2026-11-04")).toEqual(["CL on a holiday: it isn't a working day"]);
    expect(s.get("2026-11-08")).toEqual(["CL on their Sunday off: it isn't a working day"]);
    // The holiday by its name (2026-11-10): "CL on Diwali".
    const named = cellWarnings({ ...base, offDay: "weekly", days: days("weekly", { 4: "cl" }, { 4: { holidayName: "Diwali" } }) });
    expect(named.get("2026-11-04")).toEqual(["CL on Diwali, a holiday: it isn't a working day"]);
    expect(s.get("2026-11-09")).toEqual(["An off for Sunday-off staff: they take no weekly off"]);
    expect(s.get("2026-11-10")).toEqual(["H / SS on a working day: it is only for a holiday of the register"]);
    expect(s.get("2026-11-11")![0]).toContain("CH with no holiday worked");
    // A CH tied to a holiday is fine; CL past the year from the cell that goes past.
    const t = cellWarnings({ ...base, clBefore: 19, offDay: "sunday", days: days("sunday", { 5: "cl", 6: "cl", 11: "ch" }, { 11: { chHoliday: "2026-10-02" } }) });
    expect([t.has("2026-11-05"), t.get("2026-11-06"), t.has("2026-11-11")]).toEqual([false, ["CL 21 of 20 this year (KSR Part I Appendix VII)"], false]);
    // Weekly-off staff: an off taken early (3 days of duty, then an off: 3 more were needed).
    const marks = { 2: "present", 3: "present", 5: "present", 6: "off" } as const;
    const w = days("weekly", marks);
    const states = w.map((d) => ({ date: d.date, state: d.mark === "off" ? ("off" as const) : d.mark || d.holiday ? ("count" as const) : ("skip" as const) }));
    const early = cellWarnings({ ...base, offDay: "weekly", days: w, states, start: { offsDue: 0, towards: 0 } });
    // 2, 3, the holiday on 4 and 5 counted = 4 days: 2 more were needed.
    expect(early.get("2026-11-06")).toEqual(["Off taken early: 2 more days of duty were needed to earn it (one off for 6 days of duty)"]);
    expect(early.size).toBe(1);
    // CL next to regular leave; CL, CH and an off in one week.
    const near = cellWarnings({ ...base, offDay: "weekly", days: days("weekly", { 5: "cl", 7: "ch", 8: "off" }, { 6: { leave: true } }), states: undefined });
    expect(near.get("2026-11-05")).toContain("Next to regular leave from the Leave page (CL and CH aren't joined to it)");
    expect(near.get("2026-11-08")).toContain("CL, CH and an off in one week (G.O.(Ms) 303/82/HSD: CL with an off, or an off with CH, not all three)");
  });
});
