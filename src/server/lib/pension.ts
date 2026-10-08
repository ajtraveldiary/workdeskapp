// Retiring within 12 months (user request 2026-10-08): 12 months before a permanent employee still in the
// office retires, make a "Pension papers" task about them (due a year before the retirement date, when the
// pension application should go in), with the pension checklist inside. Made once per employee
// (employees.pension_task_id), so a deleted task isn't made again. Safe on every page load and from the cron.
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import type { DB } from "../db";
import { employees, events, tasks } from "../db/schema";
import { PENSION_CHECKLIST, nextYear, pensionTaskTitle, yearBefore } from "../../shared/staff";

const longDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function ensurePensionTasks(db: DB, today: string, userId?: string) {
  const due = await db
    .select({ id: employees.id, userId: employees.userId, name: employees.name, retiresOn: employees.retiresOn })
    .from(employees)
    .where(
      and(
        userId ? eq(employees.userId, userId) : undefined,
        eq(employees.permanent, true),
        isNull(employees.leftOn),
        isNull(employees.pensionTaskId),
        isNotNull(employees.retiresOn),
        // Not retired yet, and retiring within the next 12 months.
        gte(employees.retiresOn, today),
        lte(employees.retiresOn, nextYear(today)),
      ),
    );
  let made = 0;
  for (const e of due) {
    const [t] = await db
      .insert(tasks)
      .values({
        userId: e.userId,
        title: pensionTaskTitle(e.name),
        notes: `Retires on ${longDate(e.retiresOn!)}. The pension application should go in at least a year before retirement.`,
        dueDate: yearBefore(e.retiresOn!),
        priority: "high",
        checklist: PENSION_CHECKLIST.map((text, i) => ({ id: `pension-${i + 1}`, text, done: false })),
        relatedKind: "employee",
        relatedId: e.id,
        madeBySystem: true,
      })
      .returning({ id: tasks.id, title: tasks.title });
    // Only the run that sets it keeps its task (two runs at once: the other one's task is removed).
    const [claimed] = await db
      .update(employees)
      .set({ pensionTaskId: t!.id })
      .where(and(eq(employees.id, e.id), isNull(employees.pensionTaskId)))
      .returning({ id: employees.id });
    if (!claimed) {
      await db.delete(tasks).where(eq(tasks.id, t!.id));
      continue;
    }
    await db.insert(events).values({
      userId: e.userId,
      entityType: "task",
      entityId: t!.id,
      action: "task.created",
      summary: `Made for ${e.name}, retiring on ${e.retiresOn}`,
      detail: { title: t!.title },
    });
    made++;
  }
  return made;
}
