import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../app";
import { categories, emailThreads, events, gmailAccounts, reportPeriods, tasks, users } from "../db/schema";
import { timezone } from "../env";
import { addDays, todayIn } from "../lib/dates";
import { syncUser, wakeSnoozed } from "../lib/sync";
import { demoArrival } from "../lib/users";
import { maintain } from "../lib/maintenance";
import { canMarkRead } from "../lib/gmail";
import { categoryInput } from "../../shared/schemas";
import type { Summary } from "../../shared/types";
import { selectThreads, withTaskInfo } from "./threads";
import { openTaskOrder, selectTasks, toTask, viewFilter } from "./tasks";

export const miscRoutes = new Hono<AppEnv>()
  .get("/me", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
    return c.json({
      email: user!.email,
      name: user!.name,
      title: user!.title,
      picture: user!.picture,
      demo: c.get("demo"),
      today: todayIn(timezone(c.env)),
      timezone: timezone(c.env),
      account: account
        ? {
            email: account.email,
            lastSyncAt: account.lastSyncAt,
            lastSyncError: account.lastSyncError,
            pending: account.pendingThreadIds.length,
            canMarkRead: canMarkRead(account.grantedScopes),
          }
        : null,
    });
  })

  // The Command Center / daily review.
  .get("/summary", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const today = todayIn(timezone(c.env));
    await maintain(db, userId, today);
    const tomorrow = addDays(today, 1);
    const mine = eq(tasks.userId, userId);
    const weekAgo = new Date(Date.now() - 7 * 86400_000);

    const [overdue, dueToday, dueTomorrow, newActivity, recentlyCompleted, pendingEmails, pendingCounts, doneCount, openCount, upcomingCount, completedTotal, reportCounts, reportTaskCount] =
      await Promise.all([
        selectTasks(db).where(and(mine, viewFilter("overdue", today))).orderBy(...openTaskOrder),
        selectTasks(db).where(and(mine, viewFilter("today", today))).orderBy(...openTaskOrder),
        selectTasks(db).where(and(mine, eq(tasks.status, "open"), eq(tasks.dueDate, tomorrow))).orderBy(...openTaskOrder),
        selectTasks(db)
          .where(and(mine, eq(tasks.status, "open"), eq(emailThreads.hasNewActivity, true)))
          .orderBy(...openTaskOrder),
        selectTasks(db)
          .where(and(mine, eq(tasks.status, "done"), gte(tasks.completedAt, weekAgo)))
          .orderBy(desc(tasks.completedAt))
          .limit(5),
        selectThreads(db)
          .where(and(eq(emailThreads.userId, userId), eq(emailThreads.state, "needs_decision")))
          .orderBy(desc(emailThreads.lastMessageAt))
          .limit(8),
        db
          .select({ unread: emailThreads.unread, n: count() })
          .from(emailThreads)
          .where(and(eq(emailThreads.userId, userId), eq(emailThreads.state, "needs_decision")))
          .groupBy(emailThreads.unread),
        db
          .select({ n: count() })
          .from(tasks)
          .where(and(mine, eq(tasks.status, "done"), gte(tasks.completedAt, weekAgo))),
        db.select({ n: count() }).from(tasks).where(and(mine, eq(tasks.status, "open"))),
        db.select({ n: count() }).from(tasks).where(and(mine, viewFilter("upcoming", today))),
        db.select({ n: count() }).from(tasks).where(and(mine, eq(tasks.status, "done"))),
        db
          .select({
            upcoming: sql<number>`(count(*) filter (where ${reportPeriods.dueDate} >= ${today} and ${reportPeriods.dueDate} <= ${addDays(today, 30)}))::int`,
            overdue: sql<number>`(count(*) filter (where ${reportPeriods.dueDate} < ${today}))::int`,
          })
          .from(reportPeriods)
          .where(and(eq(reportPeriods.userId, userId), eq(reportPeriods.status, "pending"))),
        db.select({ n: count() }).from(tasks).where(and(mine, viewFilter("reports", today))),
      ]);

    const pending = pendingCounts.reduce((s, r) => s + r.n, 0);
    const summary: Summary = {
      today,
      counts: {
        pendingEmails: pending,
        unreadPending: pendingCounts.find((r) => r.unread)?.n ?? 0,
        dueToday: dueToday.length,
        overdue: overdue.length,
        dueTomorrow: dueTomorrow.length,
        newActivity: newActivity.length,
        completedThisWeek: doneCount[0]?.n ?? 0,
        openTasks: openCount[0]?.n ?? 0,
        upcoming: upcomingCount[0]?.n ?? 0,
        completedTotal: completedTotal[0]?.n ?? 0,
        reportsUpcoming: Number(reportCounts[0]?.upcoming ?? 0),
        reportsOverdue: Number(reportCounts[0]?.overdue ?? 0),
        reportTasks: reportTaskCount[0]?.n ?? 0,
      },
      overdue: overdue.map(toTask),
      dueToday: dueToday.map(toTask),
      dueTomorrow: dueTomorrow.map(toTask),
      newActivity: newActivity.map(toTask),
      recentlyCompleted: recentlyCompleted.map(toTask),
      pendingEmails: (await withTaskInfo(db, pendingEmails, today)) as unknown as Summary["pendingEmails"],
    };
    return c.json(summary);
  })

  .get("/history", async (c) => {
    const db = c.get("db");
    const where: (SQL | undefined)[] = [eq(events.userId, c.get("userId"))];
    const type = c.req.query("type");
    if (type === "email" || type === "task") where.push(eq(events.entityType, type));
    const q = c.req.query("q")?.trim();
    if (q) where.push(or(ilike(events.summary, `%${q}%`), sql`${events.detail}::text ilike ${`%${q}%`}`));
    const before = c.req.query("before");
    if (before) where.push(lt(events.createdAt, new Date(before)));

    const rows = await db
      .select({
        id: events.id,
        entityType: events.entityType,
        entityId: events.entityId,
        action: events.action,
        summary: events.summary,
        detail: events.detail,
        createdAt: events.createdAt,
        emailState: emailThreads.state,
      })
      .from(events)
      .leftJoin(emailThreads, and(eq(events.entityType, "email"), eq(events.entityId, emailThreads.id)))
      .where(and(...where))
      .orderBy(desc(events.createdAt))
      .limit(100);
    return c.json({ events: rows });
  })

  .get("/categories", async (c) => {
    const rows = await c
      .get("db")
      .select({ id: categories.id, name: categories.name, sortOrder: categories.sortOrder })
      .from(categories)
      .where(eq(categories.userId, c.get("userId")))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return c.json({ categories: rows });
  })

  .post("/categories", async (c) => {
    const { name } = categoryInput.parse(await c.req.json());
    const [row] = await c
      .get("db")
      .insert(categories)
      .values({ userId: c.get("userId"), name, sortOrder: 100 })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HTTPException(409, { message: "That category already exists" });
    return c.json(row, 201);
  })

  .delete("/categories/:id", async (c) => {
    await c
      .get("db")
      .delete(categories)
      .where(and(eq(categories.id, c.req.param("id")), eq(categories.userId, c.get("userId"))));
    return c.json({ ok: true });
  })

  // Manual refresh: run housekeeping now instead of waiting for its interval.
  .post("/maintain", async (c) => {
    await maintain(c.get("db"), c.get("userId"), todayIn(timezone(c.env)), true);
    return c.json({ ok: true });
  })

  // Pull new mail from Gmail (read-only). Call again while `remaining` > 0.
  .post("/sync", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    if (c.get("demo")) {
      await wakeSnoozed(db, userId);
      await demoArrival(db, userId);
      return c.json({ fetched: 1, remaining: 0 });
    }
    return c.json(await syncUser(db, c.env, userId));
  });
