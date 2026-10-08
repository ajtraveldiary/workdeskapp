// Probation pending (user request 2026-10-08): from 7 days before a permanent employee still in the office
// completes 2 years from joining service, with no probation declared date, make a task "Probation declaration:
// <name>" due on that date, "Made by system" (system_kind "probation"), about the employee. Ticking it asks
// Probation declared or Change due date (SystemTaskChooser.tsx / routes/staff.ts). Made once per employee
// (employees.probation_task_id), so a deleted task isn't made again; a declared date entered in the employee
// form completes the open task. Only joinings in the last few years (PROBATION_LOOKBACK_YEARS after the 2), so
// old staff whose declaration date was never entered don't each get one. Safe on every page load and the cron.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DB } from "../db";
import { employees, events, tasks } from "../db/schema";
import { CONTRACT_HOME_DAYS, PROBATION_LOOKBACK_YEARS, contractEnd, probationDue, probationTaskTitle, yearBefore } from "../../shared/staff";

const longDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function ensureProbationTasks(db: DB, today: string, userId?: string) {
  const windowEnd = contractEnd(today, CONTRACT_HOME_DAYS + 1); // today + 7 days
  let oldest = today;
  for (let i = 0; i < PROBATION_LOOKBACK_YEARS; i++) oldest = yearBefore(oldest);
  const mine = userId ? eq(employees.userId, userId) : undefined;

  // Declared in the employee form while the task is open: the task is done.
  const declared = await db
    .select({ userId: employees.userId, taskId: employees.probationTaskId })
    .from(employees)
    .where(and(mine, isNotNull(employees.probationTaskId), isNotNull(employees.probationDeclaredOn)));
  if (declared.length) {
    const closed = await db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), waitingSince: null, replyBy: null, updatedAt: new Date() })
      .where(and(inArray(tasks.id, declared.map((d) => d.taskId!)), eq(tasks.status, "open")))
      .returning({ id: tasks.id, userId: tasks.userId, title: tasks.title });
    if (closed.length)
      await db.insert(events).values(closed.map((t) => ({ userId: t.userId, entityType: "task" as const, entityId: t.id, action: "task.completed", summary: "Completed: probation declared", detail: { title: t.title } })));
  }

  const due = (
    await db
      .select({ id: employees.id, userId: employees.userId, name: employees.name, joined: employees.joinedServiceOn })
      .from(employees)
      .where(and(mine, eq(employees.permanent, true), isNull(employees.leftOn), isNull(employees.probationDeclaredOn), isNull(employees.probationTaskId), isNotNull(employees.joinedServiceOn)))
  )
    .map((e) => ({ ...e, due: probationDue(e.joined!) }))
    .filter((e) => e.due <= windowEnd && e.due >= oldest);
  let made = 0;
  for (const e of due) {
    const [t] = await db
      .insert(tasks)
      .values({
        userId: e.userId,
        title: probationTaskTitle(e.name),
        notes: `Joined service on ${longDate(e.joined!)}; 2 years complete on ${longDate(e.due)}. Probation declaration is pending. Tick it when declared, or change the due date if probation is extended (leave, etc.).`,
        dueDate: e.due,
        priority: "high",
        relatedKind: "employee",
        relatedId: e.id,
        madeBySystem: true,
        systemKind: "probation",
      })
      .returning({ id: tasks.id, title: tasks.title });
    // Only the run that sets it keeps its task (two runs at once: the other one's task is removed).
    const [claimed] = await db
      .update(employees)
      .set({ probationTaskId: t!.id })
      .where(and(eq(employees.id, e.id), isNull(employees.probationTaskId)))
      .returning({ id: employees.id });
    if (!claimed) {
      await db.delete(tasks).where(eq(tasks.id, t!.id));
      continue;
    }
    await db.insert(events).values({ userId: e.userId, entityType: "task", entityId: t!.id, action: "task.created", summary: `Made for ${e.name}, 2 years of service on ${e.due}`, detail: { title: t!.title } });
    made++;
  }
  return made;
}
