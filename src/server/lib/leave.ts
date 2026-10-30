// Leave (user request 2026-10-30, docs/LEAVE_PLAN.md). A leave's task holds its paperwork as steps (gazetted or
// non-gazetted, LEAVE_STEPS); like joining and relieving, it completes itself once every step is done and reopens
// when a step is set back on a task completed that way.
import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { events, tasks } from "../db/schema";
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
