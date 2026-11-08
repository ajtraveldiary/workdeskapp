// Attendance register (user request 2026-10-31, docs/ATTENDANCE_PLAN.md). Phase 1: one month as the register shows
// it (everyone in the office that month, their marks, holidays, leave from the Leave page and the year's CL / CH
// taken); marking many cells in one go (a day's column for everyone, or chosen cells) and clearing them, each one
// History entry; the office's holidays and the register's settings (Settings › Attendance). Phase 2: compensation
// leave (CH) for holidays worked, each CH tied to its holiday (openCh), the weekly-off figures (weeklyFigures) and
// the starting figures kept in the settings. Easier attendance (user request 2026-11-02, docs/ATTENDANCE_UX_PLAN.md
// phase 1): an off is marked even before it is earned (the app only warns), corrections of a weekly-off person's count
// (attendance_corrections, Correct the count), the Offs board (offsBoard) and the people who need an off for Home and
// the morning notification (offsReminder). Phase 2: days not marked count as duty (settings.assumeDuty, from each
// person's starting point), and Start the register (POST /attendance/start: everyone's starting point at once, from
// the last off). Assist plan (docs/ATTENDANCE_ASSIST_PLAN.md): GET /attendance/person/:id, one person's three weeks
// for Person days; who is in the register (settings.hideTemporary, settings.leftOut; inAttendance) filters the month,
// the Offs board, the away lists and the reminders; phase 2: who is away today and tomorrow (awayDays: GET /attendance/away, Home's line and the morning
// notification). Phase 3: offs planned ahead (planned_offs, /attendance/plans), each turned into an off mark on its day
// (settlePlannedOffs: from maintain, and before the register, the Offs board and Home's line are read).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, max, min, or, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { attendanceCorrections, attendanceMarks, attendanceSettings, plannedOffs, designations, employeeLeaves, employees, events, holidays, leaveTypes } from "../db/schema";
import { attendanceChInput, attendanceClearInput, attendanceCorrectionInput, attendanceMarkInput, attendanceSettingsInput, attendanceStartInput, holidayInput, startFigures, plannedOffInput, plannedOffMove } from "../../shared/schemas";
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  MARK_NAME,
  addMonths,
  chExpires,
  chFits,
  clDays,
  guessChLimit,
  holidayOn,
  monthDays,
  offByItself,
  weekdayOf,
  weeklyOff,
  awayDay,
  assumedDuty,
  fromLastOff,
  inAttendance,
  mondayOf,
  needsOff,
  notEligible,
  onDuty,
  offStatus,
  CL_RUN_MAX,
  type AttendanceSettings,
  type ChOpen,
  type MarkDay,
  type WeeklyDay,
  type WeeklySet,
} from "../../shared/attendance";
import { leaveEnd, leaveShort, shiftDate } from "../../shared/leave";
import { dayLabel, dayShort } from "../../shared/reminderSchedule";
import type { AttendanceMonth, AwayDays, AwayPerson, Holiday, OffNeeded, OffsBoard, OffsBoardDay, PersonDays } from "../../shared/types";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });

async function loadSettings(db: DB, userId: string): Promise<AttendanceSettings> {
  const [row] = await db.select().from(attendanceSettings).where(eq(attendanceSettings.userId, userId));
  // A day not marked is never duty (2026-11-03): an assumeDuty saved earlier is ignored.
  return { ...DEFAULT_ATTENDANCE_SETTINGS, ...(row?.data ?? {}), assumeDuty: false };
}
async function holidayMap(db: DB, userId: string, from: string, to: string) {
  const rows = await db.select().from(holidays).where(and(eq(holidays.userId, userId), gte(holidays.date, from), lte(holidays.date, to)));
  return new Map(rows.map((h) => [h.date, h.name]));
}
// Leave from the Leave page covering from–to, each clipped to it.
async function leavesIn(db: DB, userId: string, from: string, to: string, employeeIds?: string[]) {
  const rows = await db
    .select({ l: employeeLeaves, short: leaveTypes.short, name: leaveTypes.name })
    .from(employeeLeaves)
    .innerJoin(leaveTypes, eq(leaveTypes.id, employeeLeaves.typeId))
    .where(
      and(
        eq(employeeLeaves.userId, userId),
        eq(employeeLeaves.status, "active"),
        lte(employeeLeaves.fromDate, to),
        gte(employeeLeaves.toDate, from),
        employeeIds ? inArray(employeeLeaves.employeeId, employeeIds) : undefined,
      ),
    );
  return rows
    .map((r) => ({ employeeId: r.l.employeeId, from: r.l.fromDate < from ? from : r.l.fromDate, to: leaveEnd(r.l) > to ? to : leaveEnd(r.l), short: leaveShort({ name: r.name, short: r.short }), name: r.name }))
    .filter((r) => r.from <= r.to);
}
// Holidays these people worked from–to (marked present or OD on a holiday of the register; Sundays don't count) and the
// starting figures' ones, less those a CH was already taken for: each with its name and the last day to take it.
// chFor: the CH taken from `from` on, each with its holiday.
async function openCh(db: DB, userId: string, settings: AttendanceSettings, ids: string[], from: string, to: string) {
  if (!ids.length) return { open: [] as ChOpen[], chFor: [] as { employeeId: string; date: string; holiday: string }[] };
  const [hols, worked, taken] = await Promise.all([
    holidayMap(db, userId, from, to),
    db
      .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), inArray(attendanceMarks.mark, ["present", "od"]), gte(attendanceMarks.date, from), lte(attendanceMarks.date, to))),
    db
      .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, holiday: attendanceMarks.chHoliday })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), eq(attendanceMarks.mark, "ch"), isNotNull(attendanceMarks.chHoliday), gte(attendanceMarks.date, from))),
  ]);
  const chFor = taken.map((t) => ({ employeeId: t.employeeId, date: t.date, holiday: t.holiday! }));
  const used = new Set(chFor.map((t) => `${t.employeeId}|${t.holiday}`));
  const open: ChOpen[] = [];
  for (const w of worked) {
    const h = holidayOn(w.date, hols, settings);
    if (h && !used.has(`${w.employeeId}|${w.date}`)) open.push({ employeeId: w.employeeId, holiday: w.date, name: h.name, expires: chExpires(w.date) });
  }
  for (const id of ids)
    for (const s of settings.start[id]?.chOpen ?? [])
      if (!used.has(`${id}|${s.date}`) && !open.some((o) => o.employeeId === id && o.holiday === s.date)) open.push({ employeeId: id, holiday: s.date, name: s.name || "Holiday", expires: chExpires(s.date) });
  open.sort((a, b) => a.holiday.localeCompare(b.holiday));
  return { open, chFor };
}

// Weekly-off staff's figures up to the month's end (or today): from the day after their starting figures, else from
// their first mark or first correction, each day counted, an off, a fresh start or nothing (weeklyOff in
// shared/attendance.ts); a correction sets the figures as on the end of its day. `corrections`: those from `first` on.
async function weeklyFigures(db: DB, userId: string, settings: AttendanceSettings, people: { id: string; from: string | null; until: string | null }[], first: string, last: string, today: string) {
  if (!people.length) return [];
  const end = last < today ? last : today;
  const ids = people.map((p) => p.id);
  const [firstMarks, fixes] = await Promise.all([
    db
      .select({ employeeId: attendanceMarks.employeeId, first: min(attendanceMarks.date) })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids)))
      .groupBy(attendanceMarks.employeeId),
    db
      .select()
      .from(attendanceCorrections)
      .where(and(eq(attendanceCorrections.userId, userId), inArray(attendanceCorrections.employeeId, ids), lte(attendanceCorrections.date, end)))
      .orderBy(asc(attendanceCorrections.date)),
  ]);
  const fixOf = new Map(fixes.map((f) => [`${f.employeeId}|${f.date}`, { offsDue: f.offsDue, towards: f.towards, run: f.run } satisfies WeeklySet]));
  // Where each person's counting starts, and whether they have a starting point at all (starting figures, a mark or a
  // correction): days not marked are taken as duty only from one, so nobody new shows weeks of duty.
  const origin = new Map<string, boolean>();
  const starts = new Map(
    people.map((p) => {
      const s = settings.start[p.id];
      const fm = firstMarks.find((f) => f.employeeId === p.id)?.first ?? null;
      const ff = fixes.find((f) => f.employeeId === p.id)?.date ?? null;
      const begin = [fm, ff].filter((x): x is string => !!x).sort()[0];
      origin.set(p.id, !!(s || begin));
      let from = s ? shiftDate(s.asOn, 1) : (begin ?? first);
      if (p.from && from < p.from) from = p.from;
      return [p.id, from];
    }),
  );
  const earliest = [...starts.values()].sort()[0]!;
  const [marks, leaves, hols] =
    earliest <= end
      ? await Promise.all([
          db
            .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark })
            .from(attendanceMarks)
            .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), gte(attendanceMarks.date, earliest), lte(attendanceMarks.date, end))),
          leavesIn(db, userId, earliest, end, ids),
          holidayMap(db, userId, earliest, end),
        ])
      : [[], [], new Map<string, string>()];
  const markOf = new Map(marks.map((m) => [`${m.employeeId}|${m.date}`, m.mark]));
  return people.map((p) => {
    const assume = origin.get(p.id)!;
    let days: WeeklyDay[] = [];
    // The same days as marks, for G.O. 303/82's week away (leave breaks a stretch).
    const marked: MarkDay[] = [];
    for (let d = starts.get(p.id)!; d <= end && (!p.until || d <= p.until); d = shiftDate(d, 1)) {
      const m = markOf.get(`${p.id}|${d}`);
      const onLeave = leaves.some((l) => l.employeeId === p.id && l.from <= d && d <= l.to);
      marked.push(onLeave ? { date: d, mark: null } : { date: d, mark: m ?? null, holiday: !m && !!holidayOn(d, hols, settings) });
      const state: WeeklyDay["state"] = onLeave
        ? "reset"
        : m === "off"
          ? "off"
          : m === "absent"
            ? "reset"
            : m
              ? "count"
              : holidayOn(d, hols, settings)
                ? "count"
                : assume && assumedDuty(settings, d, today)
                  ? "count"
                  : "skip";
      const set = fixOf.get(`${p.id}|${d}`);
      days.push(set ? { date: d, state, set } : { date: d, state });
    }
    // CL, CH and weekly offs together for a week or more: not eligible for weekly off (G.O.(Ms) 303/82/HSD).
    days = notEligible(days, marked);
    const start = settings.start[p.id];
    const w = weeklyOff(days, start, settings, start?.run ?? 0);
    // The run, offs due and days towards the next when the month starts, so the register can work out the month's
    // runs and which offs are earned (and the bar its warnings).
    const before = weeklyOff(
      days.filter((d) => d.date < first),
      start,
      settings,
      start?.run ?? 0,
    );
    return {
      employeeId: p.id,
      // From here the register's checks count the days (null: no starting point yet).
      countFrom: assume ? starts.get(p.id)! : null,
      offsDue: w.offsDue,
      towards: w.towards,
      run: w.run,
      long: w.long.filter((d) => d >= first),
      runBefore: before.run,
      dueBefore: before.offsDue,
      towardsBefore: before.towards,
      corrections: fixes.filter((f) => f.employeeId === p.id && f.date >= first).map((f) => ({ employeeId: f.employeeId, date: f.date, offsDue: f.offsDue, towards: f.towards, run: f.run })),
      owedSince: w.owedSince,
    };
  });
}

// Days of absence in a row just before the month and just after it (CL, CH, offs, holidays not worked), up to 15
// each way: a run past 15 days with the month's CL / CH can cross its edge.
async function awayEdges(db: DB, userId: string, settings: AttendanceSettings, people: { id: string; offDay: "sunday" | "weekly"; from: string | null; until: string | null }[], first: string, last: string) {
  if (!people.length) return [];
  const before = shiftDate(first, -CL_RUN_MAX);
  const after = shiftDate(last, CL_RUN_MAX);
  const ids = people.map((p) => p.id);
  const [marks, hols, leaves] = await Promise.all([
    db
      .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark })
      .from(attendanceMarks)
      .where(
        and(
          eq(attendanceMarks.userId, userId),
          inArray(attendanceMarks.employeeId, ids),
          or(and(gte(attendanceMarks.date, before), lte(attendanceMarks.date, shiftDate(first, -1))), and(gte(attendanceMarks.date, shiftDate(last, 1)), lte(attendanceMarks.date, after))),
        ),
      ),
    holidayMap(db, userId, before, after),
    leavesIn(db, userId, before, after, ids),
  ]);
  const markOf = new Map(marks.map((m) => [`${m.employeeId}|${m.date}`, m.mark]));
  return people.map((p) => {
    const away = (d: string) =>
      (!p.from || d >= p.from) && (!p.until || d <= p.until) && !leaves.some((l) => l.employeeId === p.id && l.from <= d && d <= l.to) && awayDay(markOf.get(`${p.id}|${d}`), offByItself(d, holidayOn(d, hols, settings), p.offDay));
    let b = 0;
    while (b < CL_RUN_MAX && away(shiftDate(first, -(b + 1)))) b++;
    let a = 0;
    while (a < CL_RUN_MAX && away(shiftDate(last, a + 1))) a++;
    return { employeeId: p.id, before: b, after: a };
  });
}

// CL (with the starting figures of the same year) and CH taken in a calendar year, by employee.
async function yearTotals(db: DB, userId: string, settings: AttendanceSettings, ids: string[], year: string) {
  const totals = new Map<string, { cl: number; ch: number }>();
  if (!ids.length) return totals;
  const rows = await db
    .select({ employeeId: attendanceMarks.employeeId, mark: attendanceMarks.mark, date: attendanceMarks.date })
    .from(attendanceMarks)
    .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), gte(attendanceMarks.date, `${year}-01-01`), lte(attendanceMarks.date, `${year}-12-31`), inArray(attendanceMarks.mark, ["cl", "cl_half", "ch"])));
  // Starting figures in that year: their CL and CH taken (chTaken since 2026-11-09), then only marks after their
  // date, so a mark already in the figures isn't counted twice.
  for (const id of ids) {
    const s = settings.start[id];
    if (s && s.asOn.slice(0, 4) === year && (s.clTaken || s.chTaken)) totals.set(id, { cl: s.clTaken, ch: s.chTaken ?? 0 });
  }
  for (const r of rows) {
    const s = settings.start[r.employeeId];
    if (s && r.date <= s.asOn) continue;
    const t = totals.get(r.employeeId) ?? { cl: 0, ch: 0 };
    if (r.mark === "ch") t.ch += 1;
    else t.cl += clDays(r.mark);
    totals.set(r.employeeId, t);
  }
  return totals;
}
// A person's CH a year: their post's limit in Settings › Attendance, else guessed from its name (null = no limit).
const chLimitOf = (designationId: string | null, designation: string | null, settings: AttendanceSettings) =>
  designationId && designationId in settings.chLimits ? settings.chLimits[designationId]! : guessChLimit(designation);

// Weekly-off staff in the office today, in designation order then name, and how many Sunday-off people there are;
// only those in the register (inAttendance).
async function weeklyPeopleToday(db: DB, userId: string, today: string) {
  const [settings, all] = await Promise.all([
    loadSettings(db, userId),
    db
      .select({ e: employees, designation: designations.name, order: designations.sortOrder })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(and(eq(employees.userId, userId), or(isNull(employees.joinedOfficeOn), lte(employees.joinedOfficeOn, today)), or(isNull(employees.leftOn), gte(employees.leftOn, today)))),
  ]);
  const rows = all.filter((r) => inAttendance(r.e, settings));
  rows.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.e.name.localeCompare(b.e.name));
  const weekly = rows.filter((r) => r.e.offDay === "weekly");
  return { weekly, sundayOff: rows.length - weekly.length };
}

// "Day 3, 1 off owed" / "Day 3, 1 off taken early" / "Day 3, no off owed".
const countText = (w: { offsDue: number; run: number }) =>
  `Day ${w.run}, ${w.offsDue > 0 ? `${w.offsDue} ${w.offsDue === 1 ? "off" : "offs"} owed` : w.offsDue < 0 ? `${-w.offsDue} ${w.offsDue === -1 ? "off" : "offs"} taken early` : "no off owed"}`;

// The Offs board (docs/ATTENDANCE_UX_PLAN.md 4.6): weekly-off staff in the office today, their figures as on today,
// the last 14 days, their last off, the latest corrections, and CL / CH this year.
export async function offsBoard(db: DB, userId: string, today: string): Promise<OffsBoard> {
  await settlePlannedOffs(db, userId, today);
  const [settings, { weekly, sundayOff }] = await Promise.all([loadSettings(db, userId), weeklyPeopleToday(db, userId, today)]);
  const out: OffsBoard = { today, offEvery: settings.offEvery, maxRun: settings.maxRun, clPerYear: settings.clPerYear, assumeDuty: settings.assumeDuty, people: [], sundayOff };
  if (!weekly.length) return out;
  const ids = weekly.map((p) => p.e.id);
  const from = shiftDate(today, -13);
  const [figures, marks, leaves, hols, lastOffs, fixes, totals, ch, plans] = await Promise.all([
    weeklyFigures(
      db,
      userId,
      settings,
      weekly.map((p) => ({ id: p.e.id, from: p.e.joinedOfficeOn, until: p.e.leftOn })),
      from,
      today,
      today,
    ),
    db
      .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), gte(attendanceMarks.date, from), lte(attendanceMarks.date, today))),
    leavesIn(db, userId, from, today, ids),
    holidayMap(db, userId, from, today),
    db
      .select({ employeeId: attendanceMarks.employeeId, last: max(attendanceMarks.date) })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), eq(attendanceMarks.mark, "off"), lte(attendanceMarks.date, today)))
      .groupBy(attendanceMarks.employeeId),
    db
      .select()
      .from(attendanceCorrections)
      .where(and(eq(attendanceCorrections.userId, userId), inArray(attendanceCorrections.employeeId, ids)))
      .orderBy(desc(attendanceCorrections.date)),
    yearTotals(db, userId, settings, ids, today.slice(0, 4)),
    openCh(db, userId, settings, ids, addMonths(today, -4), today),
    db
      .select()
      .from(plannedOffs)
      .where(and(eq(plannedOffs.userId, userId), inArray(plannedOffs.employeeId, ids)))
      .orderBy(asc(plannedOffs.date)),
  ]);
  const markOf = new Map(marks.map((m) => [`${m.employeeId}|${m.date}`, m.mark]));
  const dates = Array.from({ length: 14 }, (_, i) => shiftDate(from, i));
  out.people = weekly.map(({ e, designation }) => {
    const w = figures.find((f) => f.employeeId === e.id)!;
    const days: OffsBoardDay[] = dates.map((d) => ({
      date: d,
      mark: markOf.get(`${e.id}|${d}`) ?? null,
      leave: leaves.find((l) => l.employeeId === e.id && l.from <= d && d <= l.to)?.short ?? null,
      holiday: holidayOn(d, hols, settings)?.name ?? null,
      out: !!((e.joinedOfficeOn && d < e.joinedOfficeOn) || (e.leftOn && d > e.leftOn)),
    }));
    const t = totals.get(e.id) ?? { cl: 0, ch: 0 };
    return {
      id: e.id,
      name: e.name,
      designation,
      offsDue: w.offsDue,
      towards: w.towards,
      run: w.run,
      started: w.countFrom !== null,
      owedSince: w.owedSince,
      planned: plans.filter((x) => x.employeeId === e.id).map((x) => ({ id: x.id, date: x.date, note: x.note })),
      lastOff: lastOffs.find((l) => l.employeeId === e.id)?.last ?? settings.start[e.id]?.lastOff ?? null,
      days,
      corrections: fixes
        .filter((f) => f.employeeId === e.id)
        .slice(0, 5)
        .map((f) => ({ id: f.id, date: f.date, offsDue: f.offsDue, towards: f.towards, run: f.run, note: f.note })),
      cl: t.cl,
      ch: t.ch,
      chLimit: chLimitOf(e.designationId, designation, settings),
      chOpen: ch.open.filter((o) => o.employeeId === e.id && o.expires >= today).map((o) => ({ holiday: o.holiday, name: o.name, expires: o.expires })),
    };
  });
  return out;
}

// Who is away on the next `n` days from today (docs/ATTENDANCE_ASSIST_PLAN.md 3.3): everyone in the office that day
// with an off, CL, ½CL, CH or absence marked, leave from the Leave page, or an off planned; in designation order then
// name. With `chLapsing`, also the CH that must be taken within a week.
export async function awayDays(db: DB, userId: string, today: string, n = 2, chLapsing = false): Promise<AwayDays> {
  const last = shiftDate(today, n - 1);
  const [inRegister, all] = await Promise.all([
    loadSettings(db, userId),
    db
      .select({ e: employees, order: designations.sortOrder })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(and(eq(employees.userId, userId), or(isNull(employees.joinedOfficeOn), lte(employees.joinedOfficeOn, last)), or(isNull(employees.leftOn), gte(employees.leftOn, today)))),
  ]);
  const rows = all.filter((r) => inAttendance(r.e, inRegister));
  rows.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.e.name.localeCompare(b.e.name));
  const ids = rows.map((r) => r.e.id);
  const out: AwayDays = { today, days: [], chLapsing: [] };
  if (!ids.length) {
    out.days = Array.from({ length: n }, (_, i) => ({ date: shiftDate(today, i), people: [] }));
    return out;
  }
  const [marks, leaves, plans, settings] = await Promise.all([
    db
      .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), gte(attendanceMarks.date, today), lte(attendanceMarks.date, last), inArray(attendanceMarks.mark, ["off", "cl", "cl_half", "ch", "absent", "holiday"]))),
    leavesIn(db, userId, today, last, ids),
    db
      .select({ employeeId: plannedOffs.employeeId, date: plannedOffs.date })
      .from(plannedOffs)
      .where(and(eq(plannedOffs.userId, userId), gte(plannedOffs.date, today), lte(plannedOffs.date, last))),
    chLapsing ? Promise.resolve(inRegister) : Promise.resolve(null),
  ]);
  const WHAT = { off: "Off", cl: "CL", cl_half: "½ CL", ch: "CH", absent: "Absent", holiday: "Holiday" } as const;
  for (let i = 0; i < n; i++) {
    const date = shiftDate(today, i);
    const people: AwayPerson[] = [];
    for (const { e } of rows) {
      if ((e.joinedOfficeOn && date < e.joinedOfficeOn) || (e.leftOn && date > e.leftOn)) continue;
      const leave = leaves.find((l) => l.employeeId === e.id && l.from <= date && date <= l.to);
      const m = marks.find((x) => x.employeeId === e.id && x.date === date);
      if (leave) people.push({ employeeId: e.id, name: e.name, what: `${leave.short} till ${dayShort(leave.to)}`, kind: "leave" });
      else if (m) people.push({ employeeId: e.id, name: e.name, what: WHAT[m.mark as keyof typeof WHAT], kind: m.mark as AwayPerson["kind"] });
      else if (plans.some((p) => p.employeeId === e.id && p.date === date)) people.push({ employeeId: e.id, name: e.name, what: "Off (planned)", kind: "planned" });
    }
    out.days.push({ date, people });
  }
  if (settings) {
    const { open } = await openCh(db, userId, settings, ids, addMonths(today, -4), today);
    const name = new Map(rows.map((r) => [r.e.id, r.e.name]));
    out.chLapsing = open
      .filter((o) => o.expires >= today && o.expires <= shiftDate(today, 7))
      .map((o) => ({ employeeId: o.employeeId, name: name.get(o.employeeId) ?? "", holiday: o.holiday, holidayName: o.name, expires: o.expires }));
  }
  return out;
}

// Weekly-off staff who need an off now (owed one, or past the most days in a row), most urgent first: Home's line
// and the morning notification (docs/ATTENDANCE_UX_PLAN.md 4.8).
export async function offsReminder(db: DB, userId: string, today: string): Promise<OffNeeded[]> {
  await settlePlannedOffs(db, userId, today);
  const { weekly } = await weeklyPeopleToday(db, userId, today);
  if (!weekly.length) return [];
  const settings = await loadSettings(db, userId);
  const figures = await weeklyFigures(
    db,
    userId,
    settings,
    weekly.map((p) => ({ id: p.e.id, from: p.e.joinedOfficeOn, until: p.e.leftOn })),
    today,
    today,
    today,
  );
  return weekly
    .map(({ e }) => {
      const w = figures.find((f) => f.employeeId === e.id)!;
      return { e, w, st: offStatus(w, settings) };
    })
    .filter((x) => x.w.countFrom !== null && needsOff(x.st))
    .sort((a, b) => b.st.rank - a.st.rank || b.w.run - a.w.run || a.e.name.localeCompare(b.e.name))
    .map(({ e, st }) => ({ employeeId: e.id, name: e.name, tone: st.tone, text: st.text }));
}

// Planned offs whose day has come become off marks (phase 3), unless the day already has a mark, is leave or a
// holiday, or they are no longer in the office or on weekly off; either way the plan goes. One History entry.
export async function settlePlannedOffs(db: DB, userId: string, today: string) {
  const due = await db.select().from(plannedOffs).where(and(eq(plannedOffs.userId, userId), lte(plannedOffs.date, today)));
  if (!due.length) return 0;
  const ids = [...new Set(due.map((p) => p.employeeId))];
  const dates = due.map((p) => p.date).sort();
  const [first, last] = [dates[0]!, dates[dates.length - 1]!];
  const [people, settings, hols, leaves, marks] = await Promise.all([
    db.select().from(employees).where(and(eq(employees.userId, userId), inArray(employees.id, ids))),
    loadSettings(db, userId),
    holidayMap(db, userId, first, last),
    leavesIn(db, userId, first, last, ids),
    db
      .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), gte(attendanceMarks.date, first), lte(attendanceMarks.date, last))),
  ]);
  const marked = new Set(marks.map((m) => `${m.employeeId}|${m.date}`));
  const byId = new Map(people.map((e) => [e.id, e]));
  const rows = due.filter((p) => {
    const e = byId.get(p.employeeId);
    return (
      e &&
      e.offDay === "weekly" &&
      !(e.joinedOfficeOn && p.date < e.joinedOfficeOn) &&
      !(e.leftOn && p.date > e.leftOn) &&
      !marked.has(`${p.employeeId}|${p.date}`) &&
      !holidayOn(p.date, hols, settings) &&
      !leaves.some((l) => l.employeeId === p.employeeId && l.from <= p.date && p.date <= l.to)
    );
  });
  if (rows.length)
    await db
      .insert(attendanceMarks)
      .values(rows.map((p) => ({ userId, employeeId: p.employeeId, date: p.date, mark: "off" as const })))
      .onConflictDoNothing();
  await db.delete(plannedOffs).where(inArray(plannedOffs.id, due.map((p) => p.id)));
  const dropped = due.length - rows.length;
  const list = rows.map((p) => `${byId.get(p.employeeId)!.name} (${dayLabel(p.date)})`).join(", ");
  await log(db, userId, "attendance.planned_taken", `Attendance: planned ${rows.length === 1 ? "off" : "offs"} marked: ${list || "none"}${dropped ? `; ${dropped} not marked (that day already marked, leave or a holiday)` : ""}`);
  return rows.length;
}
// Why a weekly-off person can't have an off planned on that day, or null.
async function planProblem(db: DB, userId: string, e: typeof employees.$inferSelect, date: string, today: string) {
  if (e.offDay !== "weekly") return `${e.name} has Sundays off; offs are planned for weekly-off staff`;
  if (date <= today) return "Plan an off for a day after today (for today, mark the off)";
  if ((e.joinedOfficeOn && date < e.joinedOfficeOn) || (e.leftOn && date > e.leftOn)) return `${e.name} isn't in the office on ${dayLabel(date)}`;
  const [settings, hols, leaves] = await Promise.all([loadSettings(db, userId), holidayMap(db, userId, date, date), leavesIn(db, userId, date, date, [e.id])]);
  const h = holidayOn(date, hols, settings);
  if (h) return `${dayLabel(date)} is a holiday (${h.name})`;
  if (leaves.length) return `${e.name} is on leave on ${dayLabel(date)}`;
  return null;
}

// Holidays worked (employee|date) whose CH is taken: their Present mark stays while the CH does.
async function takenFor(db: DB, userId: string, ids: string[], from: string) {
  const rows = await db
    .select({ employeeId: attendanceMarks.employeeId, holiday: attendanceMarks.chHoliday })
    .from(attendanceMarks)
    .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), eq(attendanceMarks.mark, "ch"), isNotNull(attendanceMarks.chHoliday), gte(attendanceMarks.chHoliday, from)));
  return new Set(rows.map((r) => `${r.employeeId}|${r.holiday}`));
}

// Home's reminder (phase 3): from 11 in the morning, how many people in the office today have no mark on a working
// day of theirs (not a holiday, not on leave). Null while it isn't 11 yet or the register isn't kept (no marks in
// the last 30 days), so offices that don't use it aren't reminded.
export async function unmarkedToday(db: DB, userId: string, today: string, tz: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  if (hour < 11) return null;
  const [used] = await db
    .select({ n: count() })
    .from(attendanceMarks)
    .where(and(eq(attendanceMarks.userId, userId), gte(attendanceMarks.date, shiftDate(today, -30)), lt(attendanceMarks.date, today)));
  if (!used || Number(used.n) === 0) return null;
  const [settings, hols, people, marks, leaves] = await Promise.all([
    loadSettings(db, userId),
    holidayMap(db, userId, today, today),
    db
      .select({ id: employees.id, offDay: employees.offDay, permanent: employees.permanent })
      .from(employees)
      .where(and(eq(employees.userId, userId), or(isNull(employees.joinedOfficeOn), lte(employees.joinedOfficeOn, today)), or(isNull(employees.leftOn), gte(employees.leftOn, today)))),
    db.select({ employeeId: attendanceMarks.employeeId }).from(attendanceMarks).where(and(eq(attendanceMarks.userId, userId), eq(attendanceMarks.date, today))),
    leavesIn(db, userId, today, today),
  ]);
  // Days not marked count as duty (2026-11-02): nothing to remind about.
  if (settings.assumeDuty) return null;
  const holiday = holidayOn(today, hols, settings);
  const marked = new Set(marks.map((m) => m.employeeId));
  return people.filter((p) => inAttendance(p, settings) && !marked.has(p.id) && !leaves.some((l) => l.employeeId === p.id) && !offByItself(today, holiday, p.offDay)).length;
}

// "31 Oct 2026", or "1 Oct 2026 to 5 Oct 2026" for several days.
function daysText(dates: string[]) {
  const sorted = [...new Set(dates)].sort();
  return sorted.length === 1 ? dayLabel(sorted[0]!) : `${dayLabel(sorted[0]!)} to ${dayLabel(sorted[sorted.length - 1]!)}`;
}

export const attendanceRoutes = new Hono<AppEnv>()
  // ?month=YYYY-MM (this month when left out).
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const today = todayIn(timezone(c.env));
    const month = /^\d{4}-\d{2}$/.test(c.req.query("month") ?? "") ? c.req.query("month")! : today.slice(0, 7);
    await settlePlannedOffs(db, userId, today);
    const dates = monthDays(month);
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    const year = month.slice(0, 4);
    const [settings, hols, people] = await Promise.all([
      loadSettings(db, userId),
      holidayMap(db, userId, first, last),
      db
        .select({ e: employees, designation: designations.name, order: designations.sortOrder })
        .from(employees)
        .leftJoin(designations, eq(designations.id, employees.designationId))
        .where(and(eq(employees.userId, userId), or(isNull(employees.joinedOfficeOn), lte(employees.joinedOfficeOn, last)), or(isNull(employees.leftOn), gte(employees.leftOn, first)))),
    ]).then(([s, h, all]) => [s, h, all.filter((p) => inAttendance(p.e, s))] as const);
    people.sort((a, b) => Number(b.e.permanent) - Number(a.e.permanent) || (a.order ?? 1e9) - (b.order ?? 1e9) || a.e.name.localeCompare(b.e.name));
    const ids = people.map((p) => p.e.id);
    const [marks, leaves, totals] = ids.length
      ? await Promise.all([
          db
            .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark, note: attendanceMarks.note })
            .from(attendanceMarks)
            .where(and(eq(attendanceMarks.userId, userId), gte(attendanceMarks.date, first), lte(attendanceMarks.date, last))),
          leavesIn(db, userId, first, last),
          // CL taken before the register comes from the starting figures of the same year.
          yearTotals(db, userId, settings, ids, year),
        ])
      : [[], [], new Map<string, { cl: number; ch: number }>()];
    const [ch, weekly, edges, planned] = await Promise.all([
      openCh(db, userId, settings, ids, addMonths(first, -4), last),
      weeklyFigures(
        db,
        userId,
        settings,
        people.filter((p) => p.e.offDay === "weekly").map((p) => ({ id: p.e.id, from: p.e.joinedOfficeOn, until: p.e.leftOn })),
        first,
        last,
        today,
      ),
      awayEdges(
        db,
        userId,
        settings,
        people.map((p) => ({ id: p.e.id, offDay: p.e.offDay, from: p.e.joinedOfficeOn, until: p.e.leftOn })),
        first,
        last,
      ),
      db
        .select({ id: plannedOffs.id, employeeId: plannedOffs.employeeId, date: plannedOffs.date, note: plannedOffs.note })
        .from(plannedOffs)
        .where(and(eq(plannedOffs.userId, userId), gte(plannedOffs.date, first), lte(plannedOffs.date, last))),
    ]);
    const out: AttendanceMonth = {
      month,
      today,
      settings,
      days: dates.map((d) => ({ date: d, weekday: weekdayOf(d), holiday: holidayOn(d, hols, settings) })),
      employees: people.map(({ e, designation }) => ({ id: e.id, name: e.name, designation, permanent: e.permanent, offDay: e.offDay, from: e.joinedOfficeOn, until: e.leftOn })),
      marks: marks.filter((m) => ids.includes(m.employeeId)),
      leaves: leaves.filter((l) => ids.includes(l.employeeId)),
      totals: ids.map((id) => ({ employeeId: id, ...(totals.get(id) ?? { cl: 0, ch: 0 }) })),
      chOpen: ch.open,
      chFor: ch.chFor,
      chLimits: people.map(({ e, designation }) => ({ employeeId: e.id, limit: chLimitOf(e.designationId, designation, settings) })),
      weekly: weekly.map(({ corrections: _, owedSince: __, ...w }) => w),
      edges,
      corrections: weekly.flatMap((w) => w.corrections),
      planned: planned.filter((p) => ids.includes(p.employeeId)),
    };
    return c.json(out);
  })
  // Marks every cell given. Left out (and counted by reason): someone not in the office that day, a day of leave
  // from the Leave page, a holiday (or a Sunday-off employee's Sunday) for any mark but Present (holiday duty), an off
  // for Sunday-off staff, and a cell with another mark already unless replace. An off not earned yet is marked too
  // (since 2026-11-02, docs/ATTENDANCE_UX_PLAN.md 4.3: offices give offs a day early; the app warns, and the count
  // shows it as taken early).
  .post("/mark", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = attendanceMarkInput.parse(await c.req.json());
    const ids = [...new Set(v.cells.map((x) => x.employeeId))];
    const dates = v.cells.map((x) => x.date).sort();
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const [people, settings, hols, leaves, existing] = await Promise.all([
      db.select().from(employees).where(and(eq(employees.userId, userId), inArray(employees.id, ids))),
      loadSettings(db, userId),
      holidayMap(db, userId, from, to),
      leavesIn(db, userId, from, to, ids),
      db
        .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark })
        .from(attendanceMarks)
        .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), gte(attendanceMarks.date, from), lte(attendanceMarks.date, to))),
    ]);
    const byId = new Map(people.map((e) => [e.id, e]));
    const had = new Map(existing.map((m) => [`${m.employeeId}|${m.date}`, m.mark]));
    const chTaken = await takenFor(db, userId, ids, from);
    const skipped: Record<string, number> = {};
    const skip = (why: string) => void (skipped[why] = (skipped[why] ?? 0) + 1);
    const rows: (typeof attendanceMarks.$inferInsert)[] = [];
    const seen = new Set<string>();
    for (const cell of v.cells) {
      const key = `${cell.employeeId}|${cell.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const e = byId.get(cell.employeeId);
      if (!e) {
        skip("not found");
        continue;
      }
      if ((e.joinedOfficeOn && cell.date < e.joinedOfficeOn) || (e.leftOn && cell.date > e.leftOn)) skip("not in the office");
      else if (leaves.some((l) => l.employeeId === e.id && l.from <= cell.date && cell.date <= l.to)) skip("on leave");
      // A holiday takes on duty (present / OD: holiday duty) or H / SS, the holiday taken (2026-11-03), which only a
      // holiday of the register takes.
      else if (v.mark === "holiday" && !holidayOn(cell.date, hols, settings)) skip("not a holiday");
      else if (!onDuty(v.mark) && v.mark !== "holiday" && offByItself(cell.date, holidayOn(cell.date, hols, settings), e.offDay)) skip("holiday");
      else if (v.mark === "off" && e.offDay !== "weekly") skip("Sunday-off staff");
      else if (had.get(key) === v.mark) skip("already marked");
      else if (had.has(key) && !v.replace) skip("has another mark");
      else if (chTaken.has(key)) skip("its CH is taken");
      else rows.push({ userId, employeeId: e.id, date: cell.date, mark: v.mark, chHoliday: null, note: v.mark === "od" ? v.note : "" });
    }
    if (rows.length) {
      await db
        .insert(attendanceMarks)
        .values(rows)
        .onConflictDoUpdate({ target: [attendanceMarks.employeeId, attendanceMarks.date], set: { mark: sql`excluded.mark`, chHoliday: null, note: sql`excluded.note`, updatedAt: new Date() } });
      const who = new Set(rows.map((r) => r.employeeId));
      await log(
        db,
        userId,
        "attendance.marked",
        `Attendance ${daysText(rows.map((r) => r.date))}: ${MARK_NAME[v.mark]} for ${who.size === 1 ? byId.get([...who][0]!)!.name : `${who.size} people`}${rows.length > who.size ? ` (${rows.length} days)` : ""}${v.mark === "od" && v.note ? `: ${v.note}` : ""}`,
      );
    }
    return c.json({ marked: rows.length, skipped });
  })
  .post("/clear", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = attendanceClearInput.parse(await c.req.json());
    // A holiday worked whose CH is taken keeps its mark (clear the CH first).
    const taken = await takenFor(db, userId, [...new Set(v.cells.map((x) => x.employeeId))], v.cells.map((x) => x.date).sort()[0]!);
    const cells = v.cells.filter((x) => !taken.has(`${x.employeeId}|${x.date}`));
    const gone = cells.length
      ? await db
          .delete(attendanceMarks)
          .where(and(eq(attendanceMarks.userId, userId), sql`(${attendanceMarks.employeeId}, ${attendanceMarks.date}) in (${sql.join(cells.map((x) => sql`(${x.employeeId}::uuid, ${x.date}::date)`), sql`, `)})`))
          .returning({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date })
      : [];
    if (gone.length) {
      const who = new Set(gone.map((g) => g.employeeId));
      let name = "";
      if (who.size === 1) [{ name }] = (await db.select({ name: employees.name }).from(employees).where(eq(employees.id, [...who][0]!))) as [{ name: string }];
      await log(db, userId, "attendance.cleared", `Attendance ${daysText(gone.map((g) => g.date))}: marks cleared for ${who.size === 1 ? name : `${who.size} people`}`);
    }
    return c.json({ cleared: gone.length, kept: v.cells.length - cells.length });
  })
  // Clear all attendance (user request 2026-11-03, "add an option in settings to clear all attendance; type clear all
  // to confirm deletion"; user's answer: marks, planned offs and count corrections; holidays, starting figures and
  // settings stay). The body must say "clear all".
  .post("/clear-all", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: unknown };
    if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== "clear all") throw new HTTPException(400, { message: 'Type "clear all" to confirm' });
    const [marks, plans, fixes] = await Promise.all([
      db.delete(attendanceMarks).where(eq(attendanceMarks.userId, userId)).returning({ id: attendanceMarks.id }),
      db.delete(plannedOffs).where(eq(plannedOffs.userId, userId)).returning({ id: plannedOffs.id }),
      db.delete(attendanceCorrections).where(eq(attendanceCorrections.userId, userId)).returning({ id: attendanceCorrections.id }),
    ]);
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    await log(db, userId, "attendance.cleared_all", `All attendance cleared: ${n(marks.length, "mark", "marks")}, ${n(plans.length, "planned off", "planned offs")}, ${n(fixes.length, "count correction", "count corrections")} (holidays, starting figures and settings kept)`);
    return c.json({ marks: marks.length, plans: plans.length, corrections: fixes.length });
  })
  // Mark CH (phase 2): each cell with the holiday worked it is for. Left out: not in the office, on leave, a holiday
  // (nothing to take CH on), another mark unless replace, and a holiday not open for that day (not worked, its CH
  // taken, before it or past its 3 months).
  .post("/ch", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = attendanceChInput.parse(await c.req.json());
    const ids = [...new Set(v.items.map((x) => x.employeeId))];
    const dates = v.items.map((x) => x.date).sort();
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const [people, settings, existing, leaves] = await Promise.all([
      db.select().from(employees).where(and(eq(employees.userId, userId), inArray(employees.id, ids))),
      loadSettings(db, userId),
      db
        .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark })
        .from(attendanceMarks)
        .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), gte(attendanceMarks.date, from), lte(attendanceMarks.date, to))),
      leavesIn(db, userId, from, to, ids),
    ]);
    const [hols, { open }] = await Promise.all([holidayMap(db, userId, from, to), openCh(db, userId, settings, ids, addMonths(from, -4), to)]);
    const byId = new Map(people.map((e) => [e.id, e]));
    const had = new Map(existing.map((m) => [`${m.employeeId}|${m.date}`, m.mark]));
    const skipped: Record<string, number> = {};
    const skip = (why: string) => void (skipped[why] = (skipped[why] ?? 0) + 1);
    const rows: (typeof attendanceMarks.$inferInsert)[] = [];
    const usedNow = new Set<string>();
    for (const it of v.items) {
      const e = byId.get(it.employeeId);
      const key = `${it.employeeId}|${it.date}`;
      const o = open.find((x) => x.employeeId === it.employeeId && x.holiday === it.holiday);
      if (!e) skip("not found");
      else if ((e.joinedOfficeOn && it.date < e.joinedOfficeOn) || (e.leftOn && it.date > e.leftOn)) skip("not in the office");
      else if (leaves.some((l) => l.employeeId === e.id && l.from <= it.date && it.date <= l.to)) skip("on leave");
      else if (offByItself(it.date, holidayOn(it.date, hols, settings), e.offDay)) skip("holiday");
      else if (had.has(key) && !v.replace) skip("has another mark");
      else if (!o || !chFits(o, it.date) || usedNow.has(`${it.employeeId}|${it.holiday}`)) skip("no holiday worked to take it for");
      else {
        usedNow.add(`${it.employeeId}|${it.holiday}`);
        rows.push({ userId, employeeId: e.id, date: it.date, mark: "ch", chHoliday: it.holiday });
      }
    }
    if (rows.length) {
      await db
        .insert(attendanceMarks)
        .values(rows)
        .onConflictDoUpdate({ target: [attendanceMarks.employeeId, attendanceMarks.date], set: { mark: "ch", chHoliday: sql`excluded.ch_holiday`, note: "", updatedAt: new Date() } });
      const who = new Set(rows.map((r) => r.employeeId));
      await log(
        db,
        userId,
        "attendance.ch",
        who.size === 1 && rows.length === 1
          ? `Attendance ${dayLabel(rows[0]!.date)}: CH for ${byId.get(rows[0]!.employeeId)!.name}, for the holiday worked on ${dayLabel(rows[0]!.chHoliday!)}`
          : `Attendance ${daysText(rows.map((r) => r.date))}: CH for ${who.size === 1 ? byId.get([...who][0]!)!.name : `${who.size} people`} (${rows.length} days, each for a holiday worked)`,
      );
    }
    return c.json({ marked: rows.length, skipped });
  })

  // Start the register (phase 2, docs/ATTENDANCE_UX_PLAN.md 4.5): each person's starting figures as on a day, replacing
  // theirs (holidays worked with CH to take are kept). Weekly-off staff from their last off (or the days since it):
  // every day after it counts as duty (fromLastOff), plus offs owed from before. One History entry.
  .post("/start", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = attendanceStartInput.parse(await c.req.json());
    const [settings, people] = await Promise.all([
      loadSettings(db, userId),
      db.select().from(employees).where(and(eq(employees.userId, userId), inArray(employees.id, v.people.map((p) => p.employeeId)))),
    ]);
    const byId = new Map(people.map((e) => [e.id, e]));
    const start = { ...settings.start };
    let n = 0;
    for (const p of v.people) {
      const e = byId.get(p.employeeId);
      if (!e) throw new HTTPException(404, { message: "Employee not found" });
      if (p.lastOff && p.lastOff > v.asOn) throw new HTTPException(400, { message: `${e.name}: the last off is after ${dayLabel(v.asOn)}` });
      const weekly = e.offDay === "weekly";
      const f = weekly
        ? p.lastOff
          ? fromLastOff(p.lastOff, v.asOn, p.extraOffs, settings.offEvery)
          : { run: p.days ?? 0, towards: (p.days ?? 0) % settings.offEvery, offsDue: p.extraOffs + Math.floor((p.days ?? 0) / settings.offEvery) }
        : { run: 0, towards: 0, offsDue: 0 };
      start[e.id] = { asOn: v.asOn, clTaken: p.clTaken, chOpen: settings.start[e.id]?.chOpen ?? [], ...f, lastOff: weekly ? p.lastOff : null };
      n++;
    }
    const data = { ...settings, start };
    await db.insert(attendanceSettings).values({ userId, data }).onConflictDoUpdate({ target: attendanceSettings.userId, set: { data, updatedAt: new Date() } });
    await log(db, userId, "attendance.started", `Attendance register started as on ${dayLabel(v.asOn)} for ${n === 1 ? people[0]!.name : `${n} people`}`);
    return c.json({ saved: n });
  })

  // Away today and tomorrow, and CH lapsing within a week (docs/ATTENDANCE_ASSIST_PLAN.md 3.3).
  .get("/away", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const today = todayIn(timezone(c.env));
    await settlePlannedOffs(db, userId, today);
    return c.json(await awayDays(db, userId, today, 2, true));
  })
  // Person days (docs/ATTENDANCE_ASSIST_PLAN.md 3.1): ?month=YYYY-MM gives the whole weeks (Monday to Sunday) that
  // cover the month, the Mark days calendar (user request 2026-11-03, "show the full calendar instead of the weekly
  // view"); ?from= (moved to its Monday; this week's without either) still gives 21 days, for older copies of the app.
  .get("/person/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const today = todayIn(timezone(c.env));
    await settlePlannedOffs(db, userId, today);
    const asked = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("from") ?? "") ? c.req.query("from")! : today;
    const month = /^\d{4}-\d{2}$/.test(c.req.query("month") ?? "") ? c.req.query("month")! : null;
    const from = mondayOf(month ? `${month}-01` : asked);
    // `until` (Mark leave pop-up, docs/ATTENDANCE_MARK_LEAVE_PLAN.md): with `from`, the days run on to it (at most 70
    // days from the Monday), so a CL of several working days fits in one answer.
    const until = !month && /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("until") ?? "") ? c.req.query("until")! : null;
    const to = month ? shiftDate(mondayOf(monthDays(month).at(-1)!), 6) : until && until > shiftDate(from, 20) ? (until < shiftDate(from, 69) ? until : shiftDate(from, 69)) : shiftDate(from, 20);
    const [row] = await db
      .select({ e: employees, designation: designations.name })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(and(eq(employees.userId, userId), eq(employees.id, c.req.param("id"))));
    if (!row) throw new HTTPException(404, { message: "Employee not found" });
    const { e, designation } = row;
    const [settings, hols, leaves, marks, plans, lastOff] = await Promise.all([
      loadSettings(db, userId),
      holidayMap(db, userId, from, to),
      leavesIn(db, userId, from, to, [e.id]),
      db
        .select({ date: attendanceMarks.date, mark: attendanceMarks.mark, chHoliday: attendanceMarks.chHoliday, note: attendanceMarks.note })
        .from(attendanceMarks)
        .where(and(eq(attendanceMarks.userId, userId), eq(attendanceMarks.employeeId, e.id), gte(attendanceMarks.date, from), lte(attendanceMarks.date, to))),
      db.select({ date: plannedOffs.date }).from(plannedOffs).where(and(eq(plannedOffs.userId, userId), eq(plannedOffs.employeeId, e.id), gte(plannedOffs.date, from), lte(plannedOffs.date, to))),
      db
        .select({ last: max(attendanceMarks.date) })
        .from(attendanceMarks)
        .where(and(eq(attendanceMarks.userId, userId), eq(attendanceMarks.employeeId, e.id), eq(attendanceMarks.mark, "off"), lte(attendanceMarks.date, today))),
    ]);
    const person = [{ id: e.id, from: e.joinedOfficeOn, until: e.leftOn }];
    const [totals, ch, [w], [edge]] = await Promise.all([
      yearTotals(db, userId, settings, [e.id], today.slice(0, 4)),
      openCh(db, userId, settings, [e.id], addMonths(from, -4), to),
      e.offDay === "weekly" ? weeklyFigures(db, userId, settings, person, from, to, today) : Promise.resolve([]),
      awayEdges(db, userId, settings, [{ ...person[0]!, offDay: e.offDay }], from, to),
    ]);
    const markOf = new Map(marks.map((m) => [m.date, m]));
    const planned = new Set(plans.map((p) => p.date));
    const days = Array.from({ length: Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1 }, (_, i) => {
      const date = shiftDate(from, i);
      const m = markOf.get(date);
      const h = holidayOn(date, hols, settings);
      return {
        date,
        weekday: weekdayOf(date),
        holiday: h ? h.name : e.offDay === "sunday" && weekdayOf(date) === 0 ? "Sunday" : null,
        mark: m?.mark ?? null,
        note: m?.note ?? "",
        chHoliday: m?.chHoliday ?? null,
        leave: leaves.find((l) => l.from <= date && date <= l.to)?.short ?? null,
        out: !!((e.joinedOfficeOn && date < e.joinedOfficeOn) || (e.leftOn && date > e.leftOn)),
        planned: planned.has(date),
      };
    });
    const t = totals.get(e.id) ?? { cl: 0, ch: 0 };
    const out: PersonDays = {
      today,
      from,
      to,
      settings: { offEvery: settings.offEvery, maxRun: settings.maxRun, clPerYear: settings.clPerYear, assumeDuty: settings.assumeDuty },
      employee: { id: e.id, name: e.name, designation, offDay: e.offDay, permanent: e.permanent },
      days,
      weekly: w ? { countFrom: w.countFrom, offsDue: w.offsDue, towards: w.towards, run: w.run, dueBefore: w.dueBefore, towardsBefore: w.towardsBefore, runBefore: w.runBefore, owedSince: w.owedSince } : null,
      lastOff: lastOff[0]?.last ?? settings.start[e.id]?.lastOff ?? null,
      cl: t.cl,
      ch: t.ch,
      chLimit: chLimitOf(e.designationId, designation, settings),
      chOpen: ch.open,
      edges: { before: edge?.before ?? 0, after: edge?.after ?? 0 },
    };
    return c.json(out);
  })

  // --- Planned offs (phase 3, docs/ATTENDANCE_UX_PLAN.md 4.7) ---
  // Plan an off on a day after today for a weekly-off person (not a holiday or leave). Planning the same day again
  // changes its note.
  .post("/plans", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = plannedOffInput.parse(await c.req.json());
    const today = todayIn(timezone(c.env));
    const [e] = await db.select().from(employees).where(and(eq(employees.userId, userId), eq(employees.id, v.employeeId)));
    if (!e) throw new HTTPException(404, { message: "Employee not found" });
    const problem = await planProblem(db, userId, e, v.date, today);
    if (problem) throw new HTTPException(400, { message: problem });
    const [row] = await db
      .insert(plannedOffs)
      .values({ userId, employeeId: e.id, date: v.date, note: v.note })
      .onConflictDoUpdate({ target: [plannedOffs.employeeId, plannedOffs.date], set: { note: v.note } })
      .returning({ id: plannedOffs.id });
    await log(db, userId, "attendance.planned", `Attendance: off planned for ${e.name} on ${dayLabel(v.date)}${v.note ? `. ${v.note}` : ""}`);
    return c.json({ id: row!.id });
  })
  // Move a planned off to another day.
  .put("/plans/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = plannedOffMove.parse(await c.req.json());
    const today = todayIn(timezone(c.env));
    const [p] = await db.select().from(plannedOffs).where(and(eq(plannedOffs.userId, userId), eq(plannedOffs.id, c.req.param("id"))));
    if (!p) throw new HTTPException(404, { message: "Planned off not found" });
    const [e] = await db.select().from(employees).where(eq(employees.id, p.employeeId));
    const problem = await planProblem(db, userId, e!, v.date, today);
    if (problem) throw new HTTPException(400, { message: problem });
    if (v.date !== p.date) {
      const [clash] = await db.select({ id: plannedOffs.id }).from(plannedOffs).where(and(eq(plannedOffs.employeeId, p.employeeId), eq(plannedOffs.date, v.date)));
      if (clash) throw new HTTPException(409, { message: `${e!.name} already has an off planned on ${dayLabel(v.date)}` });
      await db.update(plannedOffs).set({ date: v.date }).where(eq(plannedOffs.id, p.id));
      await log(db, userId, "attendance.plan_moved", `Attendance: planned off of ${e!.name} moved from ${dayLabel(p.date)} to ${dayLabel(v.date)}`);
    }
    return c.json({ ok: true });
  })
  .delete("/plans/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [gone] = await db.delete(plannedOffs).where(and(eq(plannedOffs.userId, userId), eq(plannedOffs.id, c.req.param("id")))).returning();
    if (!gone) throw new HTTPException(404, { message: "Planned off not found" });
    const [e] = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, gone.employeeId));
    await log(db, userId, "attendance.plan_cancelled", `Attendance: planned off of ${e?.name ?? "an employee"} on ${dayLabel(gone.date)} cancelled`);
    return c.json({ ok: true, employeeId: gone.employeeId, date: gone.date, note: gone.note });
  })

  // --- Offs board and corrections (docs/ATTENDANCE_UX_PLAN.md phase 1) ---
  .get("/offs", async (c) => c.json(await offsBoard(c.get("db"), c.get("userId"), todayIn(timezone(c.env)))))
  // Correct the count: a weekly-off person's figures as on today (one a day; a second one today replaces it).
  .post("/corrections", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = attendanceCorrectionInput.parse(await c.req.json());
    const today = todayIn(timezone(c.env));
    const [e] = await db.select().from(employees).where(and(eq(employees.userId, userId), eq(employees.id, v.employeeId)));
    if (!e) throw new HTTPException(404, { message: "Employee not found" });
    if (e.offDay !== "weekly") throw new HTTPException(400, { message: `${e.name} has Sundays off: there is no weekly-off count to correct` });
    const settings = await loadSettings(db, userId);
    if (v.towards >= settings.offEvery) throw new HTTPException(400, { message: `Days towards the next off must be less than ${settings.offEvery}` });
    const [was] = await weeklyFigures(db, userId, settings, [{ id: e.id, from: e.joinedOfficeOn, until: e.leftOn }], today, today, today);
    const [row] = await db
      .insert(attendanceCorrections)
      .values({ userId, employeeId: e.id, date: today, offsDue: v.offsDue, towards: v.towards, run: v.run, note: v.note })
      .onConflictDoUpdate({ target: [attendanceCorrections.employeeId, attendanceCorrections.date], set: { offsDue: v.offsDue, towards: v.towards, run: v.run, note: v.note, createdAt: new Date() } })
      .returning({ id: attendanceCorrections.id });
    await log(db, userId, "attendance.corrected", `Attendance: count of ${e.name} corrected to ${countText(v)}${was ? ` (was ${countText(was)})` : ""}${v.note ? `. ${v.note}` : ""}`);
    return c.json({ id: row!.id });
  })
  // Undo a correction: the count from the marks comes back.
  .delete("/corrections/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [gone] = await db
      .delete(attendanceCorrections)
      .where(and(eq(attendanceCorrections.userId, userId), eq(attendanceCorrections.id, c.req.param("id"))))
      .returning();
    if (!gone) throw new HTTPException(404, { message: "Correction not found" });
    const [e] = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, gone.employeeId));
    await log(db, userId, "attendance.correction_removed", `Attendance: correction of ${e?.name ?? "an employee"}'s count on ${dayLabel(gone.date)} taken back`);
    return c.json({ ok: true });
  })

  // --- Holidays (Settings › Attendance) ---
  // ?year=YYYY: that year's holidays the office set (second Saturdays aren't stored).
  .get("/holidays", async (c) => {
    const db = c.get("db");
    const year = /^\d{4}$/.test(c.req.query("year") ?? "") ? c.req.query("year")! : todayIn(timezone(c.env)).slice(0, 4);
    const rows = await db
      .select({ id: holidays.id, date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(and(eq(holidays.userId, c.get("userId")), gte(holidays.date, `${year}-01-01`), lte(holidays.date, `${year}-12-31`)))
      .orderBy(asc(holidays.date));
    return c.json({ holidays: rows satisfies Holiday[] });
  })
  // Adds a holiday or renames the one on that date.
  .post("/holidays", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = holidayInput.parse(await c.req.json());
    const [before] = await db.select().from(holidays).where(and(eq(holidays.userId, userId), eq(holidays.date, v.date)));
    await db.insert(holidays).values({ userId, date: v.date, name: v.name }).onConflictDoUpdate({ target: [holidays.userId, holidays.date], set: { name: v.name } });
    await log(db, userId, before ? "attendance.holiday_renamed" : "attendance.holiday_added", `Holiday ${before ? "renamed" : "added"}: ${dayLabel(v.date)}${v.name ? `, ${v.name}` : ""}`);
    return c.json({ ok: true }, before ? 200 : 201);
  })
  .delete("/holidays/:date", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const date = c.req.param("date");
    const [gone] = await db.delete(holidays).where(and(eq(holidays.userId, userId), eq(holidays.date, date))).returning();
    if (!gone) throw new HTTPException(404, { message: "No holiday on that date" });
    await log(db, userId, "attendance.holiday_removed", `Holiday removed: ${dayLabel(date)}${gone.name ? `, ${gone.name}` : ""}`);
    return c.json({ ok: true });
  })

  // --- Settings ---
  .get("/settings", async (c) => c.json({ settings: await loadSettings(c.get("db"), c.get("userId")) }))
  // One person's starting figures from the register's figures pop-up (Edit figures, 2026-11-09): as on a day (the end
  // of last month to start), CL and CH already taken that year, the holidays worked with CH still to take, and for
  // weekly-off staff the offs owed, the days carried towards the next and Day N. The register counts on from the
  // day after. Stored in settings.start, as Settings › Attendance › Starting figures does; one History entry.
  .put("/start/:employeeId", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = startFigures.parse(await c.req.json());
    const [e] = await db.select().from(employees).where(and(eq(employees.userId, userId), eq(employees.id, c.req.param("employeeId"))));
    if (!e) throw new HTTPException(404, { message: "Employee not found" });
    const settings = await loadSettings(db, userId);
    const weekly = e.offDay === "weekly";
    const figures = { ...v, chOpen: v.chOpen.filter((x) => x.date), ...(weekly ? {} : { offsDue: 0, towards: 0, run: undefined }) };
    const data = { ...settings, start: { ...settings.start, [e.id]: figures } };
    await db.insert(attendanceSettings).values({ userId, data }).onConflictDoUpdate({ target: attendanceSettings.userId, set: { data, updatedAt: new Date() } });
    await log(
      db,
      userId,
      "attendance.start_figures",
      `Attendance: figures of ${e.name} as on ${dayLabel(v.asOn)}: CL ${v.clTaken}, CH ${v.chTaken ?? 0} taken, ${figures.chOpen.length} CH to take${weekly ? `, ${v.offsDue} offs owed, ${v.towards} days carried, Day ${v.run ?? 0}` : ""}`,
    );
    return c.json({ ok: true });
  })
  .put("/settings", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    // A day not marked is never duty (2026-11-03), whatever an older copy of the app sends.
    const data = { ...attendanceSettingsInput.parse(await c.req.json()), assumeDuty: false };
    await db.insert(attendanceSettings).values({ userId, data }).onConflictDoUpdate({ target: attendanceSettings.userId, set: { data, updatedAt: new Date() } });
    await log(db, userId, "settings.attendance", `Attendance settings saved: second Saturdays ${data.secondSaturday ? "are" : "aren't"} holidays, ${data.clPerYear} days of casual leave a year, temporary staff ${data.hideTemporary ? "hidden" : "shown"}, ${data.leftOut.length} ${data.leftOut.length === 1 ? "person" : "people"} left out`);
    return c.json({ ok: true });
  });
