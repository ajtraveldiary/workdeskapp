// More emails on a task or an event (user request 2026-10-17). A task's emails are its main one (tasks.threadId)
// and any added from Pending (linked_emails); everything that asks "which tasks does this email belong to?" — the
// sync (a new reply flags the task instead of returning the email to Pending), the task/done labels in Gmail, the
// email's status tags and deleting tasks — goes through tasksOfThreads so added emails behave like the main one.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DB } from "../db";
import { emailThreads, linkedEmails, tasks } from "../db/schema";

export type ThreadTask = {
  threadId: string;
  taskId: string;
  title: string;
  status: "open" | "done";
  dueDate: string | null;
  waitingSince: Date | null;
  completedAt: Date | null;
};

const fields = { taskId: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, waitingSince: tasks.waitingSince, completedAt: tasks.completedAt };

// Every (email, task) pair for these emails: main emails and added ones.
export async function tasksOfThreads(db: DB, threadIds: string[]): Promise<ThreadTask[]> {
  if (!threadIds.length) return [];
  const [main, added] = await Promise.all([
    db.select({ threadId: tasks.threadId, ...fields }).from(tasks).where(inArray(tasks.threadId, threadIds)),
    db.select({ threadId: linkedEmails.threadId, ...fields }).from(linkedEmails).innerJoin(tasks, eq(tasks.id, linkedEmails.taskId)).where(inArray(linkedEmails.threadId, threadIds)),
  ]);
  return [...main, ...added].filter((r): r is ThreadTask => !!r.threadId);
}

// Every email of the user's tasks with its labels and whether a task of it is open (task/done label catch-up).
export async function allTaskThreads(db: DB, userId: string) {
  const [main, added] = await Promise.all([
    db
      .select({ threadId: emailThreads.id, labelIds: emailThreads.labelIds, status: tasks.status })
      .from(tasks)
      .innerJoin(emailThreads, eq(tasks.threadId, emailThreads.id))
      .where(and(eq(tasks.userId, userId), isNotNull(tasks.threadId))),
    db
      .select({ threadId: emailThreads.id, labelIds: emailThreads.labelIds, status: tasks.status })
      .from(linkedEmails)
      .innerJoin(tasks, eq(tasks.id, linkedEmails.taskId))
      .innerJoin(emailThreads, eq(emailThreads.id, linkedEmails.threadId))
      .where(eq(linkedEmails.userId, userId)),
  ]);
  return [...main, ...added];
}

// The emails added to these tasks (their main emails are tasks.threadId).
export async function addedEmailsOfTasks(db: DB, taskIds: string[]) {
  if (!taskIds.length) return [];
  return db.select({ taskId: linkedEmails.taskId, threadId: linkedEmails.threadId }).from(linkedEmails).where(inArray(linkedEmails.taskId, taskIds));
}
