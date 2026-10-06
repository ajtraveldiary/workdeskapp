import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { events, reportPeriods, reports, tasks } from "../db/schema";
import { periodsFrom } from "../../shared/reportSchedule";
import { addDays } from "./dates";

// At most this many periods are created per report per run, so a first period set far back
// doesn't flood the task list in one go.
const MAX_NEW_PER_REPORT = 24;

// Creates every period (and its task) whose task date has arrived: due date minus the report's lead days.
// Idempotent: existing periods are skipped. Safe to call on every page load and from the cron job.
export async function ensureReportPeriods(db: DB, today: string, userId?: string) {
  const active = await db
    .select()
    .from(reports)
    .where(and(eq(reports.active, true), userId ? eq(reports.userId, userId) : undefined));
  if (active.length === 0) return 0;

  const existing = await db
    .select({ reportId: reportPeriods.reportId, periodStart: reportPeriods.periodStart })
    .from(reportPeriods)
    .where(inArray(reportPeriods.reportId, active.map((r) => r.id)));
  const have = new Set(existing.map((p) => `${p.reportId}|${p.periodStart}`));

  const newPeriods: (typeof reportPeriods.$inferInsert)[] = [];
  for (const r of active) {
    const due = periodsFrom(r, r.firstPeriodStart, (p) => addDays(p.dueDate, -r.leadDays) <= today)
      .filter((p) => !have.has(`${r.id}|${p.periodStart}`))
      .slice(0, MAX_NEW_PER_REPORT);
    for (const p of due) newPeriods.push({ ...p, userId: r.userId, reportId: r.id });
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
          title: `${r.name} — ${p.label}`,
          notes: r.notes,
          dueDate: p.dueDate,
          priority: r.priority,
          labelIds: r.labelIds,
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
      summary: "Created for a report period",
      detail: { title: t.title },
    })),
  );
  return created.length;
}

// Marks a period submitted (or back to pending) and keeps its task in step, in both directions.
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
      summary: done ? `${period.label} marked submitted` : `${period.label} marked not submitted`,
      detail: { title: `${report?.name ?? "Report"} — ${period.label}` },
    },
    ...changed.map((t) => ({
      userId,
      entityType: "task" as const,
      entityId: t.id,
      action: done ? "task.completed" : "task.reopened",
      summary: done ? "Completed (report submitted)" : "Reopened (report marked not submitted)",
      detail: { title: t.title },
    })),
  ]);
  return period;
}
