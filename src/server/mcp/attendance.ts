// The attendance register for assistants (user request 2026-10-31, docs/ATTENDANCE_PLAN.md phase 3): read a month
// (everyone's summary, or one person's days), and mark attendance as the register does (a staff action: needs Allow
// changes and Allow staff actions, logged like every change). Both go through the app's own routes as the user.
import { z } from "zod";
import { MARK_NAME, MARK_SHORT, dutyForOff, monthCounts, offByItself, type AttendanceMark } from "../../shared/attendance";
import type { AttendanceMonth, StaffList } from "../../shared/types";
import { clean, type Tool } from "./tools";
import { Unclear, findEmployee, safely } from "./staff";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const ASK = " Before calling, tell the user exactly what will change and wait for their yes.";
const MARKS = { present: "present", off: "off", cl: "cl", "half day cl": "cl_half", absent: "absent", ch: "ch" } as const;

// Days from–to, both counted.
function daysFrom(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to && out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export const ATTENDANCE_READ_TOOLS: Tool[] = [
  {
    name: "get_attendance",
    title: "Attendance register",
    description:
      "A month of the attendance register: for everyone in the office, days present, holiday duty, casual leave (CL, half days ½), compensation leave (CH), weekly offs, absent, days of leave from the Leave page and working days not marked yet; this year's CL and CH; CH still to take (each holiday worked and its last day, 3 months later) and, for weekly-off staff, offs due and days in a row. With an employee, also each day's mark. The month's holidays are listed. Marks: ✓ present, O weekly off, CL, ½CL, CH, A absent.",
    input: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").optional().describe("YYYY-MM; this month when left out"),
      employee: z.string().optional().describe("Name, PEN or id, for one person's days"),
    }),
    run: safely(async (ctx, a) => {
      const m = await ctx.api<AttendanceMonth>(`/attendance?month=${a.month ?? ctx.today.slice(0, 7)}`);
      const one = a.employee ? findEmployee(await ctx.api<StaffList>("/staff"), String(a.employee)) : null;
      if (one && !m.employees.some((e) => e.id === one.id)) return { data: { error: `${one.name} wasn't in the office in ${m.month}` } };
      const counts = new Map(monthCounts(m).map((c) => [c.employeeId, c]));
      const totals = new Map(m.totals.map((t) => [t.employeeId, t]));
      const weekly = new Map(m.weekly.map((w) => [w.employeeId, w]));
      const people = m.employees.filter((e) => !one || e.id === one.id);
      return {
        data: clean({
          month: m.month,
          holidays: m.days.filter((d) => d.holiday).map((d) => ({ date: d.date, name: d.holiday!.name })),
          people: people.map((e) => {
            const c = counts.get(e.id)!;
            const w = weekly.get(e.id);
            const mark = new Map(m.marks.filter((x) => x.employeeId === e.id).map((x) => [x.date, x.mark]));
            return {
              name: e.name,
              designation: e.designation ?? undefined,
              dayOff: e.offDay === "weekly" ? "Weekly off" : "Sunday off",
              thisMonth: { present: c.present, holidayDuty: c.holidayDuty, cl: c.cl, ch: c.ch, offs: c.off, absent: c.absent, leaveDays: c.leave, notMarked: c.notMarked },
              thisYear: { cl: totals.get(e.id)?.cl ?? 0, ch: totals.get(e.id)?.ch ?? 0, clPerYear: m.settings.clPerYear, chLimit: m.chLimits.find((x) => x.employeeId === e.id)?.limit ?? "no limit" },
              chToTake: m.chOpen.filter((o) => o.employeeId === e.id && o.expires >= m.today).map((o) => ({ holiday: o.holiday, name: o.name, takeBy: o.expires })),
              weeklyOff: w ? { offsDue: w.offsDue, daysTowardsNext: `${w.towards} of ${m.settings.offEvery}`, daysOfDutyStillNeededForAnOff: dutyForOff(w.offsDue, w.towards, m.settings.offEvery), daysInARow: w.run, overTheMostOn: w.long.length ? w.long : undefined } : undefined,
              days: one
                ? m.days.map((d) => {
                    const leave = m.leaves.find((l) => l.employeeId === e.id && l.from <= d.date && d.date <= l.to);
                    const k = mark.get(d.date);
                    return `${d.date}: ${leave ? leave.short : k ? `${MARK_SHORT[k]} (${MARK_NAME[k]})` : offByItself(d.date, d.holiday, e.offDay) ? (d.holiday?.name ?? "Sunday") : d.date <= m.today ? "not marked" : "-"}`;
                  })
                : undefined,
            };
          }),
        }),
      };
    }),
  },
];

export const ATTENDANCE_STAFF_TOOLS: Tool[] = [
  {
    name: "mark_attendance",
    title: "Mark attendance",
    write: true,
    staff: true,
    description:
      "Mark the attendance register as the app does, for everyone in the office or named employees, on one day or from–to: present, off (weekly-off staff only, and only once earned: 6 counted days of duty, CL or CH per off; an off not earned is left out as 'no off earned yet'), cl, half day cl, absent, or ch (compensation leave: give holidayWorked, the holiday they worked that it is for, within the last 3 months). Holidays and Sundays of Sunday-off staff take only present (holiday duty, which earns a CH); days of leave from the Leave page and cells already marked otherwise are left out unless replace (the answer says what was left out and why)." +
      ASK,
    input: z.object({
      date: day.describe("The day, or the first day"),
      to: day.optional().describe("The last day, for several days"),
      employees: z.array(z.string()).max(100).optional().describe("Names, PENs or ids; leave out for everyone in the office"),
      mark: z.enum(["present", "off", "cl", "half day cl", "absent", "ch"]),
      holidayWorked: day.optional().describe("For ch: the holiday worked it is for"),
      replace: z.boolean().optional().describe("Also over a different mark already there"),
    }),
    run: safely(async (ctx, a) => {
      const from = String(a.date);
      const to = a.to ? String(a.to) : from;
      if (to < from) throw new Unclear("The last day is before the first.");
      const dates = daysFrom(from, to);
      const staff = await ctx.api<StaffList>("/staff");
      const ids = a.employees ? (a.employees as string[]).map((n) => findEmployee(staff, n, false).id) : staff.employees.filter((e) => !e.leftOn).map((e) => e.id);
      const mark = MARKS[a.mark as keyof typeof MARKS] as AttendanceMark;
      if (mark === "ch" && !a.holidayWorked) throw new Unclear("For CH, say which holiday they worked it is for (holidayWorked, a date). get_attendance lists their CH to take.");
      const r =
        mark === "ch"
          ? await ctx.send<{ marked: number; skipped: Record<string, number> }>("POST", "/attendance/ch", {
              items: ids.flatMap((employeeId) => dates.map((date) => ({ employeeId, date, holiday: a.holidayWorked }))),
              replace: !!a.replace,
            })
          : await ctx.send<{ marked: number; skipped: Record<string, number> }>("POST", "/attendance/mark", {
              cells: ids.flatMap((employeeId) => dates.map((date) => ({ employeeId, date }))),
              mark,
              replace: !!a.replace,
            });
      const names = ids.map((id) => staff.employees.find((e) => e.id === id)?.name ?? "Employee");
      return {
        data: clean({ done: `${MARK_NAME[mark]}: ${r.marked} marked`, leftOut: Object.keys(r.skipped).length ? r.skipped : undefined }),
        touched: r.marked ? [{ kind: "attendance", id: from, title: `Attendance ${from}${to !== from ? ` to ${to}` : ""}: ${names.length > 3 ? `${names.length} people` : names.join(", ")}` }] : [],
      };
    }),
  },
];
