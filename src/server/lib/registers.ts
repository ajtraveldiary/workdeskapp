// Registers (user request 2026-10-16): an entry with a due date has a task, and the two stay in step both ways
// (user's choice): ticking the entry completes the task and the other way round; reopening either reopens the other.
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { events, registerEntries, tasks } from "../db/schema";

export const entryTaskTitle = (register: string, text: string) => `${register}: ${text}`.slice(0, 500);

// A task was completed or reopened (Task details, To-do, Due Today…): its register entry follows.
export async function entryFollowsTask(db: DB, taskIds: string[], done: boolean) {
  if (!taskIds.length) return;
  await db
    .update(registerEntries)
    .set(done ? { status: "done", doneAt: new Date(), updatedAt: new Date() } : { status: "open", doneAt: null, updatedAt: new Date() })
    .where(and(inArray(registerEntries.taskId, taskIds), eq(registerEntries.status, done ? "open" : "done")));
}

// An entry was ticked or unticked: its task follows (with the task's own History entry).
export async function taskFollowsEntry(db: DB, userId: string, taskId: string | null, done: boolean) {
  if (!taskId) return;
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!t || (t.status === "done") === done) return;
  await db
    .update(tasks)
    .set(done ? { status: "done", completedAt: new Date(), waitingSince: null, replyBy: null, updatedAt: new Date() } : { status: "open", completedAt: null, updatedAt: new Date() })
    .where(eq(tasks.id, t.id));
  await db.insert(events).values({
    userId,
    entityType: "task",
    entityId: t.id,
    action: done ? "task.completed" : "task.reopened",
    summary: done ? "Completed: its register entry was done" : "Reopened: its register entry was reopened",
    detail: { title: t.title },
  });
}
