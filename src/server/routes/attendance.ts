// Attendance register (user request 2026-10-31, docs/ATTENDANCE_PLAN.md). Phase 1: one month as the register shows
// it (everyone in the office that month, their marks, holidays, leave from the Leave page and the year's CL / CH
// taken); marking many cells in one go (a day's column for everyone, or chosen cells) and clearing them, each one
// History entry; the office's holidays and the register's settings (Settings › Attendance). Phase 2: compensation
// leave (CH) for holidays worked, each CH tied to its holiday (openCh), the weekly-off figures (weeklyFigures) and
// the starting figures kept in the settings.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, lte, min, or, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { attendanceMarks, attendanceSettings, designations, employeeLeaves, employees, events, holidays, leaveTypes } from "../db/schema";
import { attendanceChInput, attendanceClearInput, attendanceMarkInput, attendanceSettingsInput, holidayInput } from "../../shared/schemas";
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
  CL_RUN_MAX,
  type AttendanceSettings,
  type ChOpen,
  type WeeklyDay,
} from "../../shared/attendance";
import { leaveEnd, leaveShort, shiftDate } from "../../shared/leave";
import { dayLabel } from "../../shared/reminderSchedule";
import type { AttendanceMonth, Holiday } from "../../shared/types";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });

async function loadSettings(db: DB, userId: string): Promise<AttendanceSettings> {
  const [row] = await db.select().from(attendanceSettings).where(eq(attendanceSettings.userId, userId));
  return { ...DEFAULT_ATTENDANCE_SETTINGS, ...(row?.data ?? {}) };
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
// Holidays these people worked from–to (marked present on a holiday of the register; Sundays don't count) and the
// starting figures' ones, less those a CH was already taken for: each with its name and the last day to take it.
// chFor: the CH taken from `from` on, each with its holiday.
async function openCh(db: DB, userId: string, settings: AttendanceSettings, ids: string[], from: string, to: string) {
  if (!ids.length) return { open: [] as ChOpen[], chFor: [] as { employeeId: string; date: string; holiday: string }[] };
  const [hols, worked, taken] = await Promise.all([
    holidayMap(db, userId, from, to),
    db
      .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date })
      .from(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids), eq(attendanceMarks.mark, "present"), gte(attendanceMarks.date, from), lte(attendanceMarks.date, to))),
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
// their first mark, each day counted, an off, a fresh start or nothing (weeklyOff in shared/attendance.ts).
async function weeklyFigures(db: DB, userId: string, settings: AttendanceSettings, people: { id: string; from: string | null; until: string | null }[], first: string, last: string, today: string) {
  if (!people.length) return [];
  const end = last < today ? last : today;
  const ids = people.map((p) => p.id);
  const firstMarks = await db
    .select({ employeeId: attendanceMarks.employeeId, first: min(attendanceMarks.date) })
    .from(attendanceMarks)
    .where(and(eq(attendanceMarks.userId, userId), inArray(attendanceMarks.employeeId, ids)))
    .groupBy(attendanceMarks.employeeId);
  const starts = new Map(
    people.map((p) => {
      const s = settings.start[p.id];
      let from = s ? shiftDate(s.asOn, 1) : (firstMarks.find((f) => f.employeeId === p.id)?.first ?? first);
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
    const days: WeeklyDay[] = [];
    for (let d = starts.get(p.id)!; d <= end && (!p.until || d <= p.until); d = shiftDate(d, 1)) {
      const m = markOf.get(`${p.id}|${d}`);
      const state: WeeklyDay["state"] = leaves.some((l) => l.employeeId === p.id && l.from <= d && d <= l.to)
        ? "reset"
        : m === "off"
          ? "off"
          : m === "absent"
            ? "reset"
            : m
              ? "count"
              : holidayOn(d, hols, settings)
                ? "count"
                : "skip";
      days.push({ date: d, state });
    }
    const w = weeklyOff(days, settings.start[p.id], settings);
    // The run when the month starts, so the register can work out the month's runs (and the bar its warnings).
    const runBefore = weeklyOff(days.filter((d) => d.date < first), settings.start[p.id], settings).run;
    return { employeeId: p.id, offsDue: w.offsDue, towards: w.towards, run: w.run, long: w.long.filter((d) => d >= first), runBefore };
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
      .select({ id: employees.id, offDay: employees.offDay })
      .from(employees)
      .where(and(eq(employees.userId, userId), or(isNull(employees.joinedOfficeOn), lte(employees.joinedOfficeOn, today)), or(isNull(employees.leftOn), gte(employees.leftOn, today)))),
    db.select({ employeeId: attendanceMarks.employeeId }).from(attendanceMarks).where(and(eq(attendanceMarks.userId, userId), eq(attendanceMarks.date, today))),
    leavesIn(db, userId, today, today),
  ]);
  const holiday = holidayOn(today, hols, settings);
  const marked = new Set(marks.map((m) => m.employeeId));
  return people.filter((p) => !marked.has(p.id) && !leaves.some((l) => l.employeeId === p.id) && !offByItself(today, holiday, p.offDay)).length;
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
    ]);
    people.sort((a, b) => Number(b.e.permanent) - Number(a.e.permanent) || (a.order ?? 1e9) - (b.order ?? 1e9) || a.e.name.localeCompare(b.e.name));
    const ids = people.map((p) => p.e.id);
    const [marks, leaves, yearMarks] = ids.length
      ? await Promise.all([
          db
            .select({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date, mark: attendanceMarks.mark })
            .from(attendanceMarks)
            .where(and(eq(attendanceMarks.userId, userId), gte(attendanceMarks.date, first), lte(attendanceMarks.date, last))),
          leavesIn(db, userId, first, last),
          db
            .select({ employeeId: attendanceMarks.employeeId, mark: attendanceMarks.mark, n: sql<number>`count(*)::int` })
            .from(attendanceMarks)
            .where(and(eq(attendanceMarks.userId, userId), gte(attendanceMarks.date, `${year}-01-01`), lte(attendanceMarks.date, `${year}-12-31`), inArray(attendanceMarks.mark, ["cl", "cl_half", "ch"])))
            .groupBy(attendanceMarks.employeeId, attendanceMarks.mark),
        ])
      : [[], [], []];
    const totals = new Map<string, { cl: number; ch: number }>();
    // CL taken before the register, from the starting figures of the same year.
    for (const id of ids) {
      const s = settings.start[id];
      if (s && s.asOn.slice(0, 4) === year && s.clTaken) totals.set(id, { cl: s.clTaken, ch: 0 });
    }
    for (const r of yearMarks) {
      const t = totals.get(r.employeeId) ?? { cl: 0, ch: 0 };
      if (r.mark === "ch") t.ch += Number(r.n);
      else t.cl += clDays(r.mark) * Number(r.n);
      totals.set(r.employeeId, t);
    }
    const [ch, weekly, edges] = await Promise.all([
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
      chLimits: people.map(({ e, designation }) => ({
        employeeId: e.id,
        limit: e.designationId && e.designationId in settings.chLimits ? settings.chLimits[e.designationId]! : guessChLimit(designation),
      })),
      weekly,
      edges,
    };
    return c.json(out);
  })
  // Marks every cell given. Left out (and counted by reason): someone not in the office that day, a day of leave
  // from the Leave page, a holiday (or a Sunday-off employee's Sunday) for any mark but Present (holiday duty), an off
  // for Sunday-off staff, and a cell with another mark already unless replace.
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
      else if (v.mark !== "present" && offByItself(cell.date, holidayOn(cell.date, hols, settings), e.offDay)) skip("holiday");
      else if (v.mark === "off" && e.offDay !== "weekly") skip("Sunday-off staff");
      else if (had.get(key) === v.mark) skip("already marked");
      else if (had.has(key) && !v.replace) skip("has another mark");
      else if (chTaken.has(key)) skip("its CH is taken");
      else rows.push({ userId, employeeId: e.id, date: cell.date, mark: v.mark, chHoliday: null });
    }
    if (rows.length) {
      await db
        .insert(attendanceMarks)
        .values(rows)
        .onConflictDoUpdate({ target: [attendanceMarks.employeeId, attendanceMarks.date], set: { mark: sql`excluded.mark`, chHoliday: null, updatedAt: new Date() } });
      const who = new Set(rows.map((r) => r.employeeId));
      await log(
        db,
        userId,
        "attendance.marked",
        `Attendance ${daysText(rows.map((r) => r.date))}: ${MARK_NAME[v.mark]} for ${who.size === 1 ? byId.get([...who][0]!)!.name : `${who.size} people`}${rows.length > who.size ? ` (${rows.length} days)` : ""}`,
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
        .onConflictDoUpdate({ target: [attendanceMarks.employeeId, attendanceMarks.date], set: { mark: "ch", chHoliday: sql`excluded.ch_holiday`, updatedAt: new Date() } });
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
  .put("/settings", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const data = attendanceSettingsInput.parse(await c.req.json());
    await db.insert(attendanceSettings).values({ userId, data }).onConflictDoUpdate({ target: attendanceSettings.userId, set: { data, updatedAt: new Date() } });
    await log(db, userId, "settings.attendance", `Attendance settings saved: second Saturdays ${data.secondSaturday ? "are" : "aren't"} holidays, ${data.clPerYear} days of casual leave a year`);
    return c.json({ ok: true });
  });
