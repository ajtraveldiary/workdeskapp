// Joining and relieving an employee (user request 2026-10-15). Starting one makes its task (For the employee, made
// by the system, the steps of MOVE_STEPS as its checklist, due MOVE_DUE_DAYS after the date) and a row in
// employee_moves. The table on the Employees page and the task's checklist are the same steps, so settleMoveTask
// completes the task once every step is done, and reopens a task that was completed that way when a step is set
// back.
import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { employeeMoves, events, tasks } from "../db/schema";
import { addDays } from "./dates";
import { MOVE_DUE_DAYS, moveChecklist, moveTitle, type MoveKind } from "../../shared/moves";
import { dayLabel } from "../../shared/reminderSchedule";
import type { ChecklistItem } from "../../shared/types";

export const MOVE_SYSTEM_KIND = { join: "joining", relieve: "relieving" } as const;
const isMoveTask = (k: string | null) => k === "joining" || k === "relieving";

// doneSteps: step ids already done (someone already working here, user request 2026-10-16).
export async function startMove(db: DB, userId: string, employee: { id: string; name: string }, kind: MoveKind, date: string, doneSteps: string[] = []) {
  const checklist = moveChecklist(kind).map((i) => (doneSteps.includes(i.id) ? { ...i, done: true } : i));
  const [task] = await db
    .insert(tasks)
    .values({
      userId,
      title: moveTitle(kind, employee.name),
      notes: `${kind === "join" ? "Joined this office" : "Relieved"} on ${dayLabel(date)}`,
      dueDate: addDays(date, MOVE_DUE_DAYS),
      priority: "normal",
      checklist,
      relatedKind: "employee",
      relatedId: employee.id,
      madeBySystem: true,
      systemKind: MOVE_SYSTEM_KIND[kind],
    })
    .returning();
  const [move] = await db.insert(employeeMoves).values({ userId, employeeId: employee.id, kind, onDate: date, taskId: task!.id }).returning();
  await db.insert(events).values({ userId, entityType: "task", entityId: task!.id, action: "task.created", summary: `Made by system: ${kind === "join" ? "joining" : "relieving"} steps`, detail: { title: task!.title } });
  // Every step already done: nothing left, so it is completed straight away.
  await settleMoveTask(db, userId, task!, [], checklist);
  return { task: task!, move: move! };
}

const allDone = (items: ChecklistItem[]) => items.length > 0 && items.every((i) => i.done);

// After a joining / relieving task's steps changed (from the table or the task itself).
export async function settleMoveTask(db: DB, userId: string, task: { id: string; title: string; status: "open" | "done"; systemKind: string | null }, before: ChecklistItem[], after: ChecklistItem[]) {
  if (!isMoveTask(task.systemKind)) return;
  if (task.status === "open" && allDone(after)) {
    await db.update(tasks).set({ status: "done", completedAt: new Date(), waitingSince: null, replyBy: null, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    await db.insert(events).values({ userId, entityType: "task", entityId: task.id, action: "task.completed", summary: "Completed: every step done", detail: { title: task.title } });
  } else if (task.status === "done" && allDone(before) && !allDone(after)) {
    await db.update(tasks).set({ status: "open", completedAt: null, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    await db.insert(events).values({ userId, entityType: "task", entityId: task.id, action: "task.reopened", summary: "Reopened: a step is no longer done", detail: { title: task.title } });
  }
}
