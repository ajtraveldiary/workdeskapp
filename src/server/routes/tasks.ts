import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, gt, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { emailThreads, gmailAccounts, tasks } from "../db/schema";
import { timezone } from "../env";
import { logEvent } from "../lib/audit";
import { todayIn } from "../lib/dates";
import { taskInput, taskPatch } from "../../shared/schemas";
import type { Task, TaskView } from "../../shared/types";

const priorityRank = sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;
export const openTaskOrder = [sql`${tasks.dueDate} asc nulls last`, priorityRank, asc(tasks.createdAt)];

export function selectTasks(db: DB) {
  return db
    .select({
      task: tasks,
      thread: {
        id: emailThreads.id,
        gmailThreadId: emailThreads.gmailThreadId,
        accountEmail: gmailAccounts.email,
        subject: emailThreads.subject,
        fromName: emailThreads.fromName,
        fromEmail: emailThreads.fromEmail,
        hasNewActivity: emailThreads.hasNewActivity,
      },
    })
    .from(tasks)
    .leftJoin(emailThreads, eq(tasks.threadId, emailThreads.id))
    .leftJoin(gmailAccounts, eq(emailThreads.accountId, gmailAccounts.id));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectTasks>["execute"]>>[number];

export function toTask({ task, thread }: Row): Task {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
    categoryId: task.categoryId,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    thread: thread?.id ? (thread as Task["thread"]) : null,
  };
}

export function viewFilter(view: TaskView, today: string): SQL | undefined {
  const open = eq(tasks.status, "open");
  switch (view) {
    case "today":
      return and(open, eq(tasks.dueDate, today));
    case "overdue":
      return and(open, lt(tasks.dueDate, today));
    case "upcoming":
      return and(open, gt(tasks.dueDate, today));
    case "nodate":
      return and(open, isNull(tasks.dueDate));
    case "all":
      return open;
    case "completed":
      return eq(tasks.status, "done");
  }
}

async function loadTask(db: DB, userId: string, id: string) {
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Task not found" });
  return t;
}

const VIEWS: TaskView[] = ["today", "upcoming", "overdue", "nodate", "all", "completed"];

export const taskRoutes = new Hono<AppEnv>()
  .get("/day", async (c) => {
    const today = todayIn(timezone(c.env));
    const date = c.req.query("date") ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HTTPException(400, { message: "Use date=YYYY-MM-DD" });
    const onDay = eq(tasks.dueDate, date);
    const rows = await selectTasks(c.get("db"))
      .where(
        and(
          eq(tasks.userId, c.get("userId")),
          date === today ? or(onDay, and(eq(tasks.status, "open"), lt(tasks.dueDate, today))) : onDay,
        ),
      )
      .orderBy(desc(tasks.status), ...openTaskOrder);
    return c.json({ date, today, tasks: rows.map(toTask) });
  })

  .get("/", async (c) => {
    const db = c.get("db");
    const view = (c.req.query("view") ?? "all") as TaskView;
    if (!VIEWS.includes(view)) throw new HTTPException(400, { message: "Unknown view" });
    const today = todayIn(timezone(c.env));
    const where: (SQL | undefined)[] = [eq(tasks.userId, c.get("userId")), viewFilter(view, today)];
    const q = c.req.query("q")?.trim();
    if (q) where.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.notes, `%${q}%`), ilike(emailThreads.subject, `%${q}%`)));
    const category = c.req.query("category");
    if (category) where.push(eq(tasks.categoryId, category));

    const rows = await selectTasks(db)
      .where(and(...where))
      .orderBy(...(view === "completed" ? [desc(tasks.completedAt)] : openTaskOrder))
      .limit(500);
    return c.json({ tasks: rows.map(toTask), today });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = taskInput.parse(await c.req.json());
    const [task] = await db
      .insert(tasks)
      .values({ ...input, userId })
      .returning();
    await logEvent(db, { userId, entityType: "task", entityId: task!.id, action: "task.created", summary: "Created manually", detail: { title: task!.title } });
    return c.json(task, 201);
  })

  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = taskPatch.parse(await c.req.json());
    const t = await loadTask(db, userId, c.req.param("id"));
    await db.update(tasks).set({ ...input, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    if (input.dueDate !== undefined && input.dueDate !== t.dueDate) {
      await logEvent(db, {
        userId,
        entityType: "task",
        entityId: t.id,
        action: "task.rescheduled",
        summary: input.dueDate ? `Due date set to ${input.dueDate}` : "Due date removed",
        detail: { title: input.title ?? t.title },
      });
    }
    return c.json({ ok: true });
  })

  // Completing a task changes only the task record; its email stays as it is, in Gmail and here.
  .post("/:id/complete", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadTask(db, userId, c.req.param("id"));
    if (t.status === "done") return c.json({ ok: true });
    await db.update(tasks).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, t.id));
    await logEvent(db, { userId, entityType: "task", entityId: t.id, action: "task.completed", summary: "Completed", detail: { title: t.title } });
    return c.json({ ok: true });
  })

  .post("/:id/reopen", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadTask(db, userId, c.req.param("id"));
    if (t.status === "open") return c.json({ ok: true });
    await db.update(tasks).set({ status: "open", completedAt: null, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    await logEvent(db, { userId, entityType: "task", entityId: t.id, action: "task.reopened", summary: "Reopened", detail: { title: t.title } });
    return c.json({ ok: true });
  });
