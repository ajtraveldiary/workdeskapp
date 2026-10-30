// Leave (user request 2026-10-30, docs/LEAVE_PLAN.md). A leave's task holds its paperwork as steps (gazetted or
// non-gazetted, LEAVE_STEPS); like joining and relieving, it completes itself once every step is done and reopens
// when a step is set back on a task completed that way. Phase 3: the automatic yearly credits.
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { DB } from "../db";
import { employeeLeaves, employees, events, leaveLedger, leaveTypes, tasks } from "../db/schema";
import { addYears, calendarDays, daysWord, earnedFromDuty, formatDays, leaveEnd, leaveShort, shiftDate } from "../../shared/leave";
import { dayLabel } from "../../shared/reminderSchedule";
import type { ChecklistItem } from "../../shared/types";

const allDone = (items: ChecklistItem[]) => items.length > 0 && items.every((i) => i.done);

export async function settleLeaveTask(db: DB, userId: string, task: { id: string; title: string; status: "open" | "done"; systemKind: string | null }, before: ChecklistItem[], after: ChecklistItem[]) {
  if (task.systemKind !== "leave") return;
  if (task.status === "open" && allDone(after)) {
    await db.update(tasks).set({ status: "done", completedAt: new Date(), waitingSince: null, replyBy: null, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    await db.insert(events).values({ userId, entityType: "task", entityId: task.id, action: "task.completed", summary: "Completed: every step done", detail: { title: task.title } });
  } else if (task.status === "done" && allDone(before) && !allDone(after)) {
    await db.update(tasks).set({ status: "open", completedAt: null, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    await db.insert(events).values({ userId, entityType: "task", entityId: task.id, action: "task.reopened", summary: "Reopened: a step is no longer done", detail: { title: task.title } });
  }
}

// Each employee's balance of one type, for the employees given.
async function balancesOf(db: DB, typeId: string, employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, number>();
  const rows = await db
    .select({ employeeId: leaveLedger.employeeId, total: sql<string>`sum(${leaveLedger.days})` })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.typeId, typeId), inArray(leaveLedger.employeeId, employeeIds)))
    .groupBy(leaveLedger.employeeId);
  return new Map(rows.map((r) => [r.employeeId, Number(r.total)]));
}

// A credit that takes a balance above the type's maximum: the extra lapses, as its own line.
export async function lapseAbove(db: DB, userId: string, type: typeof leaveTypes.$inferSelect, employeeIds: string[], onDate: string) {
  if (type.maxBalance == null || !employeeIds.length) return 0;
  const bal = await balancesOf(db, type.id, employeeIds);
  const over = employeeIds.map((id) => ({ id, extra: (bal.get(id) ?? 0) - type.maxBalance! })).filter((x) => x.extra > 0);
  if (over.length)
    await db.insert(leaveLedger).values(
      over.map((x) => ({ userId, employeeId: x.id, typeId: type.id, onDate, days: -x.extra, kind: "lapse" as const, note: `Above the most that can be kept (${daysWord(type.maxBalance!)})` })),
    );
  return over.length;
}

// Automatic yearly credits (phase 3; run by maintain, so by the queue's upkeep job). For each leave type switched to
// automatic (creditsFrom), every permanent employee still in the office gets, on each anniversary of joining service
// from creditsFrom up to today: the fixed days (HPL 20 for each completed year), or for earned leave from duty, 1/11
// of the days on duty in the service year just ended (less every day of leave marked in WorkDesk), only when their
// probation is declared. Never twice for one year (creditFor, the anniversary's year; Credit now uses the same), and
// never for an anniversary on or before their opening balance's date (the opening already holds it). Returns how
// many were credited.
export async function ensureLeaveCredits(db: DB, today: string, userId?: string) {
  const auto = await db
    .select()
    .from(leaveTypes)
    .where(and(userId ? eq(leaveTypes.userId, userId) : undefined, isNotNull(leaveTypes.creditsFrom), eq(leaveTypes.hasAccount, true)));
  const rules = auto.filter((t) => t.fromDuty || (t.yearlyDays ?? 0) > 0);
  if (!rules.length) return 0;
  const staff = await db
    .select({ id: employees.id, userId: employees.userId, name: employees.name, joined: employees.joinedServiceOn, probationDeclared: employees.probationDeclared })
    .from(employees)
    .where(and(inArray(employees.userId, [...new Set(rules.map((t) => t.userId))]), eq(employees.permanent, true), isNull(employees.leftOn), isNotNull(employees.joinedServiceOn)));

  type Due = { e: (typeof staff)[number]; t: (typeof rules)[number]; year: number; on: string };
  const due: Due[] = [];
  for (const t of rules)
    for (const e of staff) {
      if (e.userId !== t.userId || (t.fromDuty && !e.probationDeclared)) continue;
      for (let k = 1; k < 80; k++) {
        const on = addYears(e.joined!, k);
        if (on > today) break;
        if (on >= t.creditsFrom!) due.push({ e, t, year: k, on });
      }
    }
  if (!due.length) return 0;

  const ids = [...new Set(due.map((d) => d.e.id))];
  const known = await db
    .select({ employeeId: leaveLedger.employeeId, typeId: leaveLedger.typeId, kind: leaveLedger.kind, creditFor: leaveLedger.creditFor, onDate: leaveLedger.onDate })
    .from(leaveLedger)
    .where(and(inArray(leaveLedger.employeeId, ids), inArray(leaveLedger.typeId, rules.map((t) => t.id)), or(isNotNull(leaveLedger.creditFor), eq(leaveLedger.kind, "opening"))));
  const credited = new Set(known.filter((l) => l.creditFor).map((l) => `${l.employeeId}:${l.typeId}:${l.creditFor}`));
  const opening = new Map(known.filter((l) => l.kind === "opening").map((l) => [`${l.employeeId}:${l.typeId}`, l.onDate]));
  const todo = due.filter((d) => {
    const o = opening.get(`${d.e.id}:${d.t.id}`);
    return !credited.has(`${d.e.id}:${d.t.id}:${d.on.slice(0, 4)}`) && !(o && o >= d.on);
  });
  if (!todo.length) return 0;

  // Earned leave from duty: the leaves inside each service year.
  const dutyIds = [...new Set(todo.filter((d) => d.t.fromDuty).map((d) => d.e.id))];
  const leaves = dutyIds.length
    ? await db
        .select({ employeeId: employeeLeaves.employeeId, fromDate: employeeLeaves.fromDate, toDate: employeeLeaves.toDate, rejoinedOn: employeeLeaves.rejoinedOn })
        .from(employeeLeaves)
        .where(and(inArray(employeeLeaves.employeeId, dutyIds), eq(employeeLeaves.status, "active")))
    : [];

  const lines = todo
    .map((d) => {
      const creditFor = d.on.slice(0, 4);
      const anniversary = `Service anniversary ${dayLabel(d.on)}`;
      if (!d.t.fromDuty) return { d, days: d.t.yearlyDays!, creditFor, note: `${anniversary} (${d.year} year${d.year === 1 ? "" : "s"} of service)` };
      // The service year just ended, from the opening balance's date when that is later.
      const o = opening.get(`${d.e.id}:${d.t.id}`);
      const yearStart = addYears(d.e.joined!, d.year - 1);
      const start = o && o > yearStart ? o : yearStart;
      const last = shiftDate(d.on, -1);
      const total = calendarDays(start, last);
      let away = 0;
      for (const l of leaves) {
        if (l.employeeId !== d.e.id) continue;
        const s = l.fromDate > start ? l.fromDate : start;
        const end = leaveEnd(l) < last ? leaveEnd(l) : last;
        if (end >= s) away += calendarDays(s, end);
      }
      const duty = total - away;
      return { d, days: earnedFromDuty(duty), creditFor, note: `${anniversary}: ${total} days, ${away} on leave → ${duty} on duty ÷ 11` };
    })
    .filter((x) => x.days > 0);
  if (!lines.length) return 0;

  const added = await db
    .insert(leaveLedger)
    .values(lines.map((x) => ({ userId: x.d.e.userId, employeeId: x.d.e.id, typeId: x.d.t.id, onDate: x.d.on, days: x.days, kind: "credit" as const, creditFor: x.creditFor, note: x.note })))
    .onConflictDoNothing()
    .returning({ employeeId: leaveLedger.employeeId, typeId: leaveLedger.typeId, creditFor: leaveLedger.creditFor });
  const done = lines.filter((x) => added.some((a) => a.employeeId === x.d.e.id && a.typeId === x.d.t.id && a.creditFor === x.creditFor));
  if (!done.length) return 0;
  await db.insert(events).values(
    done.map((x) => ({
      userId: x.d.e.userId,
      entityType: "sync" as const,
      action: "staff.leave_credited_auto",
      summary: `Leave account of ${x.d.e.name}: Credit +${formatDays(x.days)} ${leaveShort(x.d.t)} for ${x.creditFor} (service anniversary, automatic)`,
    })),
  );
  for (const t of rules) {
    const who = [...new Set(done.filter((x) => x.d.t.id === t.id).map((x) => x.d.e.id))];
    if (who.length) await lapseAbove(db, t.userId, t, who, today);
  }
  return done.length;
}
