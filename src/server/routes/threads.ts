import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { EMAIL_STATES, emailThreads, gmailAccounts, tasks } from "../db/schema";
import { logEvent } from "../lib/audit";
import { maintain } from "../lib/maintenance";
import { bulkIds, snoozeInput, taskInput, threadPatch } from "../../shared/schemas";
import { events } from "../db/schema";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";
import type { ThreadTaskInfo } from "../../shared/types";

// Every route here changes only WorkDesk's own database. Gmail is never written to.

export const threadColumns = {
  id: emailThreads.id,
  gmailThreadId: emailThreads.gmailThreadId,
  accountEmail: gmailAccounts.email,
  subject: emailThreads.subject,
  fromName: emailThreads.fromName,
  fromEmail: emailThreads.fromEmail,
  snippet: emailThreads.snippet,
  lastMessageAt: emailThreads.lastMessageAt,
  messageCount: emailThreads.messageCount,
  unread: emailThreads.unread,
  state: emailThreads.state,
  snoozedUntil: emailThreads.snoozedUntil,
  hasNewActivity: emailThreads.hasNewActivity,
  categoryId: emailThreads.categoryId,
  stateChangedAt: emailThreads.stateChangedAt,
};

export function selectThreads(db: DB) {
  return db.select(threadColumns).from(emailThreads).leftJoin(gmailAccounts, eq(emailThreads.accountId, gmailAccounts.id));
}

type ThreadRow = Awaited<ReturnType<ReturnType<typeof selectThreads>["execute"]>>[number];

// Adds the state of each email's linked tasks (open / done / overdue), so lists can tag them.
export async function withTaskInfo<T extends ThreadRow>(db: DB, threads: T[], today: string) {
  const ids = threads.map((t) => t.id);
  const rows = ids.length
    ? await db
        .select({
          threadId: tasks.threadId,
          open: sql<number>`(count(*) filter (where ${tasks.status} = 'open'))::int`,
          done: sql<number>`(count(*) filter (where ${tasks.status} = 'done'))::int`,
          overdue: sql<boolean>`coalesce(bool_or(${tasks.status} = 'open' and ${tasks.dueDate} < ${today}), false)`,
        })
        .from(tasks)
        .where(inArray(tasks.threadId, ids))
        .groupBy(tasks.threadId)
    : [];
  const byThread = new Map(rows.map((r) => [r.threadId, { open: Number(r.open), done: Number(r.done), overdue: !!r.overdue }]));
  return threads.map((t) => ({ ...t, task: (byThread.get(t.id) ?? null) as ThreadTaskInfo | null }));
}

async function loadThread(db: DB, userId: string, id: string) {
  const [t] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, id), eq(emailThreads.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Email not found" });
  return t;
}

async function setState(
  db: DB,
  userId: string,
  id: string,
  set: Partial<typeof emailThreads.$inferInsert>,
  action: string,
  summary: string,
) {
  const t = await loadThread(db, userId, id);
  await db
    .update(emailThreads)
    .set({ snoozedUntil: null, ...set, stateChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(emailThreads.id, t.id));
  await logEvent(db, { userId, entityType: "email", entityId: t.id, action, summary, detail: { subject: t.subject } });
  return t;
}

export const threadRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    await maintain(db, userId, todayIn(timezone(c.env)));

    const state = c.req.query("state") ?? "needs_decision";
    const q = c.req.query("q")?.trim();
    const where: (SQL | undefined)[] = [eq(emailThreads.userId, userId)];
    if (state !== "all") {
      if (!(EMAIL_STATES as readonly string[]).includes(state)) throw new HTTPException(400, { message: "Unknown state" });
      where.push(eq(emailThreads.state, state as (typeof EMAIL_STATES)[number]));
    }
    if (c.req.query("unread") === "1") where.push(eq(emailThreads.unread, true));
    const category = c.req.query("category");
    if (category) where.push(eq(emailThreads.categoryId, category));
    if (q) {
      const like = `%${q}%`;
      where.push(
        or(
          ilike(emailThreads.subject, like),
          ilike(emailThreads.fromName, like),
          ilike(emailThreads.fromEmail, like),
          ilike(emailThreads.snippet, like),
        ),
      );
    }

    const [threads, counts] = await Promise.all([
      selectThreads(db)
        .where(and(...where))
        .orderBy(desc(emailThreads.lastMessageAt))
        .limit(300),
      db
        .select({ state: emailThreads.state, n: count() })
        .from(emailThreads)
        .where(eq(emailThreads.userId, userId))
        .groupBy(emailThreads.state),
    ]);
    return c.json({
      threads: await withTaskInfo(db, threads, todayIn(timezone(c.env))),
      counts: Object.fromEntries(counts.map((r) => [r.state, r.n])),
    });
  })

  .post("/:id/task", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = taskInput.parse(await c.req.json());
    const t = await loadThread(db, userId, c.req.param("id"));
    const [task] = await db
      .insert(tasks)
      .values({ ...input, userId, threadId: t.id, categoryId: input.categoryId ?? t.categoryId })
      .returning();
    await db
      .update(emailThreads)
      .set({ state: "task", snoozedUntil: null, hasNewActivity: false, stateChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailThreads.id, t.id));
    await db.insert(events).values([
      { userId, entityType: "email", entityId: t.id, action: "email.converted", summary: "Converted to task", detail: { subject: t.subject } },
      { userId, entityType: "task", entityId: task!.id, action: "task.created", summary: "Created from email", detail: { title: task!.title, subject: t.subject } },
    ]);
    return c.json(task, 201);
  })

  .post("/:id/dismiss", async (c) => {
    await setState(c.get("db"), c.get("userId"), c.req.param("id"), { state: "dismissed" }, "email.dismissed", "Dismissed from queue");
    return c.json({ ok: true });
  })

  .post("/bulk-dismiss", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { ids } = bulkIds.parse(await c.req.json());
    const done = await db
      .update(emailThreads)
      .set({ state: "dismissed", snoozedUntil: null, stateChangedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, ids), eq(emailThreads.state, "needs_decision")))
      .returning({ id: emailThreads.id, subject: emailThreads.subject });
    if (done.length) {
      await db.insert(events).values(
        done.map((t) => ({
          userId,
          entityType: "email" as const,
          entityId: t.id,
          action: "email.dismissed",
          summary: "Dismissed from queue (bulk)",
          detail: { subject: t.subject },
        })),
      );
    }
    return c.json({ dismissed: done.length });
  })

  .post("/:id/restore", async (c) => {
    await setState(c.get("db"), c.get("userId"), c.req.param("id"), { state: "needs_decision" }, "email.restored", "Returned to queue");
    return c.json({ ok: true });
  })

  .post("/:id/snooze", async (c) => {
    const { until } = snoozeInput.parse(await c.req.json());
    const when = new Date(until);
    if (when.getTime() <= Date.now()) throw new HTTPException(400, { message: "Snooze time must be in the future" });
    await setState(
      c.get("db"),
      c.get("userId"),
      c.req.param("id"),
      { state: "snoozed", snoozedUntil: when },
      "email.snoozed",
      `Snoozed until ${when.toISOString()}`,
    );
    return c.json({ ok: true });
  })

  .post("/:id/seen", async (c) => {
    const db = c.get("db");
    const t = await loadThread(db, c.get("userId"), c.req.param("id"));
    await db.update(emailThreads).set({ hasNewActivity: false }).where(eq(emailThreads.id, t.id));
    return c.json({ ok: true });
  })

  .patch("/:id", async (c) => {
    const db = c.get("db");
    const { categoryId } = threadPatch.parse(await c.req.json());
    const t = await loadThread(db, c.get("userId"), c.req.param("id"));
    await db.update(emailThreads).set({ categoryId, updatedAt: new Date() }).where(eq(emailThreads.id, t.id));
    return c.json({ ok: true });
  });
