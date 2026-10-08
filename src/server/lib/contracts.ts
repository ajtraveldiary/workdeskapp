// Contract ending (user request 2026-10-08, replacing the special Due Today rows of the same day): from 7 days
// before a temporary employee's contract ends, WorkDesk makes a task "Contract ends: <name>", due on the end
// date, "Made by system" (system_kind "contract"), about the employee. Ticking it asks Renew or Contract ended
// (routes/staff.ts), which also completes it. One task per end date (employees.contract_task_for): a renewed
// contract gets a new task 7 days before its new end; an edited end date moves the open task to it.
// Safe on every page load and from the cron.
import { and, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { DB } from "../db";
import { employees, events, tasks } from "../db/schema";
import { CONTRACT_HOME_DAYS, contractEnd, contractTaskTitle } from "../../shared/staff";

const longDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const notesFor = (end: string, days: number | null) =>
  `Contract ends on ${longDate(end)}${days ? ` (contract period ${days} days)` : ""}. Tick it to renew the contract or mark it ended.`;

export async function ensureContractTasks(db: DB, today: string, userId?: string) {
  const windowEnd = contractEnd(today, CONTRACT_HOME_DAYS + 1); // today + 7 days
  const rows = await db
    .select({ id: employees.id, userId: employees.userId, name: employees.name, end: employees.engagedTill, days: employees.contractDays, taskId: employees.contractTaskId, taskFor: employees.contractTaskFor })
    .from(employees)
    .where(
      and(
        userId ? eq(employees.userId, userId) : undefined,
        eq(employees.permanent, false),
        isNull(employees.leftOn),
        isNotNull(employees.engagedTill),
        // No task for this end date yet: either ending within 7 days, or one was made for another date.
        or(isNull(employees.contractTaskFor), ne(employees.contractTaskFor, employees.engagedTill)),
        or(lte(employees.engagedTill, windowEnd), isNotNull(employees.contractTaskFor)),
      ),
    );
  let made = 0;
  for (const e of rows) {
    const end = e.end!;
    // The end date was edited while its task is still open: the task moves to the new date.
    if (e.taskId) {
      const [open] = await db
        .update(tasks)
        .set({ title: contractTaskTitle(e.name), notes: notesFor(end, e.days), dueDate: end, updatedAt: new Date() })
        .where(and(eq(tasks.id, e.taskId), eq(tasks.status, "open")))
        .returning({ id: tasks.id });
      if (open) {
        await db.update(employees).set({ contractTaskFor: end }).where(eq(employees.id, e.id));
        continue;
      }
    }
    if (end > windowEnd) continue; // a new task only from 7 days before
    const [t] = await db
      .insert(tasks)
      .values({
        userId: e.userId,
        title: contractTaskTitle(e.name),
        notes: notesFor(end, e.days),
        dueDate: end,
        priority: "high",
        relatedKind: "employee",
        relatedId: e.id,
        madeBySystem: true,
        systemKind: "contract",
      })
      .returning({ id: tasks.id, title: tasks.title });
    // Only the run that sets it keeps its task (two runs at once: the other one's task is removed).
    const [claimed] = await db
      .update(employees)
      .set({ contractTaskId: t!.id, contractTaskFor: end })
      .where(and(eq(employees.id, e.id), or(isNull(employees.contractTaskFor), ne(employees.contractTaskFor, end))))
      .returning({ id: employees.id });
    if (!claimed) {
      await db.delete(tasks).where(eq(tasks.id, t!.id));
      continue;
    }
    await db.insert(events).values({ userId: e.userId, entityType: "task", entityId: t!.id, action: "task.created", summary: `Made for ${e.name}, contract ending on ${end}`, detail: { title: t!.title } });
    made++;
  }
  return made;
}
