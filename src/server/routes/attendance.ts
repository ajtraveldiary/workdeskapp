// Attendance register (user request 2026-10-31, docs/ATTENDANCE_PLAN.md, phase 1). One month as the register shows
// it (everyone in the office that month, their marks, holidays, leave from the Leave page and the year's CL / CH
// taken); marking many cells in one go (a day's column for everyone, or chosen cells) and clearing them, each one
// History entry; the office's holidays and the register's settings (Settings › Attendance).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { attendanceMarks, attendanceSettings, designations, employeeLeaves, employees, events, holidays, leaveTypes } from "../db/schema";
import { attendanceClearInput, attendanceMarkInput, attendanceSettingsInput, holidayInput } from "../../shared/schemas";
import { DEFAULT_ATTENDANCE_SETTINGS, MARK_NAME, clDays, holidayOn, monthDays, offByItself, weekdayOf, type AttendanceSettings } from "../../shared/attendance";
import { leaveEnd, leaveShort } from "../../shared/leave";
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
    for (const r of yearMarks) {
      const t = totals.get(r.employeeId) ?? { cl: 0, ch: 0 };
      if (r.mark === "ch") t.ch += Number(r.n);
      else t.cl += clDays(r.mark) * Number(r.n);
      totals.set(r.employeeId, t);
    }
    const out: AttendanceMonth = {
      month,
      today,
      settings,
      days: dates.map((d) => ({ date: d, weekday: weekdayOf(d), holiday: holidayOn(d, hols, settings) })),
      employees: people.map(({ e, designation }) => ({ id: e.id, name: e.name, designation, permanent: e.permanent, offDay: e.offDay, from: e.joinedOfficeOn, until: e.leftOn })),
      marks: marks.filter((m) => ids.includes(m.employeeId)),
      leaves: leaves.filter((l) => ids.includes(l.employeeId)),
      totals: ids.map((id) => ({ employeeId: id, ...(totals.get(id) ?? { cl: 0, ch: 0 }) })),
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
    const gone = await db
      .delete(attendanceMarks)
      .where(and(eq(attendanceMarks.userId, userId), sql`(${attendanceMarks.employeeId}, ${attendanceMarks.date}) in (${sql.join(v.cells.map((x) => sql`(${x.employeeId}::uuid, ${x.date}::date)`), sql`, `)})`))
      .returning({ employeeId: attendanceMarks.employeeId, date: attendanceMarks.date });
    if (gone.length) {
      const who = new Set(gone.map((g) => g.employeeId));
      let name = "";
      if (who.size === 1) [{ name }] = (await db.select({ name: employees.name }).from(employees).where(eq(employees.id, [...who][0]!))) as [{ name: string }];
      await log(db, userId, "attendance.cleared", `Attendance ${daysText(gone.map((g) => g.date))}: marks cleared for ${who.size === 1 ? name : `${who.size} people`}`);
    }
    return c.json({ cleared: gone.length });
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
