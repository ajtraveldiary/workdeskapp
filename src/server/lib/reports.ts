import { and, eq, inArray, max } from "drizzle-orm";
import type { DB } from "../db";
import { events, reportPeriods, reports, tasks } from "../db/schema";
import { dayLabel, occurrences } from "../../shared/reminderSchedule";
import { addDays } from "./dates";

// At most this many occurrences are created per reminder per run, so a start date set far back doesn't
// flood the task list in one go.
const MAX_NEW_PER_REPORT = 24;

// Creates every reminder occurrence (and its task) whose task date has arrived: the date minus "Remind me".
// Only dates after the reminder's latest occurrence are added, so editing a reminder changes what comes next
// and never re-creates or moves what exists. Safe to call on every page load and from the cron job.
export async function ensureReportPeriods(db: DB, today: string, userId?: string) {
  const active = await db
    .select()
    .from(reports)
    .where(and(eq(reports.active, true), userId ? eq(reports.userId, userId) : undefined));
  if (active.length === 0) return 0;

  const latest = await db
    .select({ reportId: reportPeriods.reportId, last: max(reportPeriods.dueDate) })
    .from(reportPeriods)
    .where(inArray(reportPeriods.reportId, active.map((r) => r.id)))
    .groupBy(reportPeriods.reportId);
  const lastDue = new Map(latest.map((l) => [l.reportId, l.last]));

  const newPeriods: (typeof reportPeriods.$inferInsert)[] = [];
  for (const r of active) {
    const last = lastDue.get(r.id);
    const due = occurrences(r, (d) => addDays(d, -r.leadDays) <= today)
      .filter((d) => !last || d > last)
      .slice(0, MAX_NEW_PER_REPORT);
    for (const d of due) newPeriods.push({ userId: r.userId, reportId: r.id, periodStart: d, periodEnd: d, dueDate: d, label: dayLabel(d) });
  }
  if (newPeriods.length === 0) return 0;

  const created = await db.insert(reportPeriods).values(newPeriods).onConflictDoNothing().returning();
  if (created.length === 0) return 0;

  const byId = new Map(active.map((r) => [r.id, r]));
  const newTasks = await db
    .insert(tasks)
    .values(
      created.map((p) => {
        const r = byId.get(p.reportId)!;
        return {
          userId: p.userId,
          title: r.name,
          notes: r.notes,
          dueDate: p.dueDate,
          dueTime: r.dueTime,
          priority: r.priority,
          reportPeriodId: p.id,
        };
      }),
    )
    .returning({ id: tasks.id, userId: tasks.userId, title: tasks.title });
  await db.insert(events).values(
    newTasks.map((t) => ({
      userId: t.userId,
      entityType: "task" as const,
      entityId: t.id,
      action: "task.created",
      summary: "Created by a reminder",
      detail: { title: t.title },
    })),
  );
  return created.length;
}

// Marks an occurrence done (or not done) and keeps its task in step, in both directions.
export async function setPeriodStatus(db: DB, userId: string, periodId: string, status: "pending" | "submitted") {
  const [period] = await db
    .update(reportPeriods)
    .set({ status, submittedAt: status === "submitted" ? new Date() : null })
    .where(and(eq(reportPeriods.id, periodId), eq(reportPeriods.userId, userId)))
    .returning();
  if (!period) return null;

  const done = status === "submitted";
  const changed = await db
    .update(tasks)
    .set({ status: done ? "done" : "open", completedAt: done ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tasks.reportPeriodId, period.id), eq(tasks.status, done ? "open" : "done")))
    .returning({ id: tasks.id, title: tasks.title });

  const [report] = await db.select({ name: reports.name }).from(reports).where(eq(reports.id, period.reportId));
  await db.insert(events).values([
    {
      userId,
      entityType: "report" as const,
      entityId: period.reportId,
      action: done ? "report.submitted" : "report.reopened",
      summary: done ? `${period.label} marked done` : `${period.label} marked not done`,
      detail: { title: `${report?.name ?? "Reminder"} — ${period.label}` },
    },
    ...changed.map((t) => ({
      userId,
      entityType: "task" as const,
      entityId: t.id,
      action: done ? "task.completed" : "task.reopened",
      summary: done ? "Completed (reminder done)" : "Reopened (reminder marked not done)",
      detail: { title: t.title },
    })),
  ]);
  return period;
}
