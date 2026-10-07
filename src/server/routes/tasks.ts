import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, gt, gte, ilike, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
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
    waitingSince: task.waitingSince?.toISOString() ?? null,
    replyBy: task.replyBy,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    thread: thread?.id ? (threadInfo as Task["thread"]) : null,
    report: report?.periodId ? ({ ...report, links: report.links ?? [] } as Task["report"]) : null,
  };
}

export function viewFilter(view: TaskView, today: string): SQL | undefined {
  const open = eq(tasks.status, "open");
  // Tasks waiting for a reply (user request 2026-10-07) leave the to-do views for "waiting"; they come back
  // to Today / Overdue by the day a reply is expected (replyBy) instead of their due date.
  const notWaiting = isNull(tasks.waitingSince);
  const waiting = isNotNull(tasks.waitingSince);
  switch (view) {
    case "today":
      return and(open, or(and(notWaiting, eq(tasks.dueDate, today)), and(waiting, eq(tasks.replyBy, today))));
    case "overdue":
      return and(open, or(and(notWaiting, lt(tasks.dueDate, today)), and(waiting, lt(tasks.replyBy, today))));
    case "upcoming":
      return and(open, notWaiting, gt(tasks.dueDate, today));
    case "nodate":
      return and(open, notWaiting, isNull(tasks.dueDate));
    case "all":
      return and(open, notWaiting);
    case "waiting":
      return and(open, waiting);
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

// New tasks made waiting for a reply (user request 2026-10-07).
export const waitingFields = (waiting: boolean, replyBy: string | null) => (waiting ? { waitingSince: new Date(), replyBy } : { waitingSince: null, replyBy: null });
export const waitingSummary = (replyBy: string | null) => (replyBy ? `Waiting for a reply, expected by ${replyBy}` : "Waiting for a reply");

const VIEWS: TaskView[] = ["today", "upcoming", "overdue", "nodate", "all", "completed", "any", "reports", "waiting"];

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
      .orderBy(...(view === "completed" ? [desc(tasks.completedAt)] : view === "waiting" ? [sql`${tasks.replyBy} asc nulls last`, asc(tasks.waitingSince)] : openTaskOrder))
      .limit(500);
    return c.json({ tasks: rows.map(toTask), today });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { waiting, replyBy, ...input } = taskInput.parse(await c.req.json());
    const [task] = await db
      .insert(tasks)
      .values({ ...input, userId, ...waitingFields(waiting, replyBy) })
      .returning();
    await logEvent(db, { userId, entityType: "task", entityId: task!.id, action: "task.created", summary: "Created manually", detail: { title: task!.title } });
    if (waiting) await logEvent(db, { userId, entityType: "task", entityId: task!.id, action: "task.waiting", summary: waitingSummary(replyBy), detail: { title: task!.title } });
    return c.json(task, 201);
  })

  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { waiting, replyBy, ...input } = taskPatch.parse(await c.req.json());
    const t = await loadTask(db, userId, c.req.param("id"));
    if (input.labelIds !== undefined && t.threadId) {
      throw new HTTPException(400, { message: "This task uses its email's labels; change them on the email" });
    }
    // Waiting for a reply (user request 2026-10-07). A completed task can be put back to waiting too: it is
    // reopened. Reminder tasks move with their reminder date, so they don't wait.
    const wasWaiting = !!t.waitingSince && t.status === "open";
    const willWait = waiting ?? wasWaiting;
    if (waiting && t.reportPeriodId) throw new HTTPException(400, { message: "A reminder's task can't wait for a reply" });
    const startsWaiting = waiting === true && !wasWaiting;
    const reopened = startsWaiting && t.status === "done";
    const waitSet = !willWait
      ? { waitingSince: null, replyBy: null }
      : {
          ...(startsWaiting ? { waitingSince: new Date() } : {}),
          ...(replyBy !== undefined ? { replyBy } : startsWaiting ? { replyBy: null } : {}),
          ...(reopened ? { status: "open" as const, completedAt: null } : {}),
        };
    // Only the fields sent are changed. Removing the due date also removes its time.
    await db
      .update(tasks)
      .set({ ...input, ...(input.dueDate === null ? { dueTime: null } : {}), ...waitSet, updatedAt: new Date() })
      .where(eq(tasks.id, t.id));
    const title = input.title ?? t.title;
    if (startsWaiting) {
      await logEvent(db, { userId, entityType: "task", entityId: t.id, action: "task.waiting", summary: waitingSummary(replyBy ?? null), detail: { title } });
    } else if (wasWaiting && !willWait) {
      await logEvent(db, { userId, entityType: "task", entityId: t.id, action: "task.waiting_ended", summary: "No longer waiting for a reply; back to to-do", detail: { title } });
    } else if (wasWaiting && replyBy !== undefined && replyBy !== t.replyBy) {
      await logEvent(db, { userId, entityType: "task", entityId: t.id, action: "task.reply_date", summary: replyBy ? `Reply expected by ${replyBy}` : "Reply date removed", detail: { title } });
    }
    if (reopened && t.threadId) await reconcileThreadLabels(db, c.env, userId, [t.threadId]).catch(() => undefined);
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
    // Completing also ends any wait for a reply.
    await db.update(tasks).set({ status: "done", completedAt: new Date(), waitingSince: null, replyBy: null, updatedAt: new Date() }).where(eq(tasks.id, t.id));
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
