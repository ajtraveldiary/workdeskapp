import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, gt, gte, ilike, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { emailThreads, gmailAccounts, reportPeriods, reports, tasks } from "../db/schema";
import { timezone } from "../env";
import { logEvent } from "../lib/audit";
import { todayIn } from "../lib/dates";
import { setPeriodStatus } from "../lib/reports";
import { reconcileThreadLabels } from "../lib/taskLabels";
import { taskInput, taskPatch } from "../../shared/schemas";
import type { Task, TaskView } from "../../shared/types";

const priorityRank = sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;
export const openTaskOrder = [
  sql`${tasks.dueDate} asc nulls last`,
  sql`${tasks.dueTime} asc nulls last`,
  priorityRank,
  asc(tasks.createdAt),
];

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
        labelIds: emailThreads.labelIds,
      },
      report: {
        reportId: reports.id,
        periodId: reportPeriods.id,
        name: reports.name,
        label: reportPeriods.label,
        links: reports.links,
      },
    })
    .from(tasks)
    .leftJoin(emailThreads, eq(tasks.threadId, emailThreads.id))
    .leftJoin(gmailAccounts, eq(emailThreads.accountId, gmailAccounts.id))
    .leftJoin(reportPeriods, eq(tasks.reportPeriodId, reportPeriods.id))
    .leftJoin(reports, eq(reportPeriods.reportId, reports.id));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectTasks>["execute"]>>[number];

export function toTask({ task, thread, report }: Row): Task {
  // A task from an email shows the email's Gmail labels; one without an email has its own.
  const { labelIds: threadLabels, ...threadInfo } = thread ?? { labelIds: null };
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    status: task.status,
    labelIds: thread?.id ? (threadLabels ?? []) : task.labelIds,
    checklist: task.checklist ?? [],
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    thread: thread?.id ? (threadInfo as Task["thread"]) : null,
    report: report?.periodId ? ({ ...report, links: report.links ?? [] } as Task["report"]) : null,
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
    case "reports":
      return and(open, sql`${tasks.reportPeriodId} is not null`);
    case "any":
      return undefined;
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

const VIEWS: TaskView[] = ["today", "upcoming", "overdue", "nodate", "all", "completed", "any", "reports"];

export const taskRoutes = new Hono<AppEnv>()
  // Calendar: everything due in a date range.
  .get("/range", async (c) => {
    const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!isDay(from) || !isDay(to)) throw new HTTPException(400, { message: "Use from=YYYY-MM-DD&to=YYYY-MM-DD" });
    const rows = await selectTasks(c.get("db"))
      .where(and(eq(tasks.userId, c.get("userId")), gte(tasks.dueDate, from!), lte(tasks.dueDate, to!)))
      .orderBy(...openTaskOrder);
    return c.json({ from, to, today: todayIn(timezone(c.env)), tasks: rows.map(toTask) });
  })

  .get("/", async (c) => {
    const db = c.get("db");
    const view = (c.req.query("view") ?? "all") as TaskView;
    if (!VIEWS.includes(view)) throw new HTTPException(400, { message: "Unknown view" });
    const today = todayIn(timezone(c.env));
    const where: (SQL | undefined)[] = [eq(tasks.userId, c.get("userId")), viewFilter(view, today)];
    const q = c.req.query("q")?.trim();
    if (q) where.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.notes, `%${q}%`), ilike(emailThreads.subject, `%${q}%`)));
    // Label filter: the email's labels for tasks from an email, the task's own otherwise.
    const label = c.req.query("label");
    if (label) where.push(sql`${label} = any(coalesce(${emailThreads.labelIds}, ${tasks.labelIds}))`);

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
    if (input.labelIds !== undefined && t.threadId) {
      throw new HTTPException(400, { message: "This task uses its email's labels; change them on the email" });
    }
    // Only the fields sent are changed. Removing the due date also removes its time.
    await db
      .update(tasks)
      .set({ ...input, ...(input.dueDate === null ? { dueTime: null } : {}), updatedAt: new Date() })
      .where(eq(tasks.id, t.id));
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
    // A report's task and its period move together.
    if (t.reportPeriodId) await setPeriodStatus(db, userId, t.reportPeriodId, "submitted");
    if (t.threadId) await reconcileThreadLabels(db, c.env, userId, [t.threadId]).catch(() => undefined);
    return c.json({ ok: true });
  })

  .post("/:id/reopen", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadTask(db, userId, c.req.param("id"));
    if (t.status === "open") return c.json({ ok: true });
    await db.update(tasks).set({ status: "open", completedAt: null, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    await logEvent(db, { userId, entityType: "task", entityId: t.id, action: "task.reopened", summary: "Reopened", detail: { title: t.title } });
    if (t.reportPeriodId) await setPeriodStatus(db, userId, t.reportPeriodId, "pending");
    if (t.threadId) await reconcileThreadLabels(db, c.env, userId, [t.threadId]).catch(() => undefined);
    return c.json({ ok: true });
  });
