// Private calendar link (user request 2026-10-07): tasks and reminders as a calendar that Apple Calendar,
// Google Calendar or Outlook subscribe to. The feed itself needs no sign-in (calendar apps can't sign in);
// the long random token in the link is the key, and making a new link stops the old one.
import { Hono } from "hono";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { AppEnv } from "../app";
import { emailThreads, events, reportPeriods, reports, tasks, users } from "../db/schema";
import { timezone } from "../env";
import { randomToken } from "../lib/crypto";
import { todayIn } from "../lib/dates";
import { buildCalendar, type FeedReminder, type FeedTask } from "../lib/ics";

const appUrl = (env: AppEnv["Bindings"], requestUrl: string) => (env.APP_URL || new URL(requestUrl).origin).replace(/\/$/, "");
const feedUrl = (env: AppEnv["Bindings"], requestUrl: string, token: string) => `${appUrl(env, requestUrl)}/api/calendar/${token}.ics`;

// Public: GET /api/calendar/<token>.ics
export const calendarFeedRoute = new Hono<AppEnv>().get("/calendar/:file", async (c) => {
  const token = /^([\w-]{20,})\.ics$/.exec(c.req.param("file"))?.[1];
  if (!token) return c.text("Not found", 404);
  const db = c.get("db");
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.calendarToken, token));
  if (!user) return c.text("Not found", 404);
  const tz = timezone(c.env);
  const today = todayIn(tz);

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      notes: tasks.notes,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      priority: tasks.priority,
      updatedAt: tasks.updatedAt,
      from: emailThreads.fromName,
      fromEmail: emailThreads.fromEmail,
      subject: emailThreads.subject,
    })
    .from(tasks)
    .leftJoin(emailThreads, eq(emailThreads.id, tasks.threadId))
    // Open tasks with a date; reminder tasks show as the reminders themselves.
    .where(and(eq(tasks.userId, user.id), eq(tasks.status, "open"), isNotNull(tasks.dueDate), isNull(tasks.reportPeriodId)));
  const feedTasks: FeedTask[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate!,
    dueTime: t.dueTime,
    priority: t.priority,
    updatedAt: t.updatedAt,
    email: t.subject != null ? { from: t.from ?? t.fromEmail, subject: t.subject } : null,
  }));

  const reminderRows = await db.select().from(reports).where(and(eq(reports.userId, user.id), eq(reports.active, true)));
  const done = reminderRows.length
    ? await db
        .select({ reportId: reportPeriods.reportId, dueDate: reportPeriods.dueDate })
        .from(reportPeriods)
        .where(and(inArray(reportPeriods.reportId, reminderRows.map((r) => r.id)), eq(reportPeriods.status, "submitted")))
    : [];
  const feedReminders: FeedReminder[] = reminderRows.map((r) => ({
    id: r.id,
    name: r.name,
    notes: r.notes,
    dueTime: r.dueTime,
    updatedAt: r.updatedAt,
    repeat: r.repeat,
    startDate: r.startDate,
    dueDay: r.dueDay,
    endDate: r.endDate,
    doneDates: new Set(done.filter((d) => d.reportId === r.id).map((d) => d.dueDate)),
  }));

  const ics = buildCalendar({ tasks: feedTasks, reminders: feedReminders, today, tz, appUrl: appUrl(c.env, c.req.url) });
  return c.body(ics, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'inline; filename="workdesk.ics"',
    "Cache-Control": "private, max-age=300",
    "X-Robots-Tag": "noindex",
  });
});

// Signed in: Settings > Calendar.
export const calendarSettingsRoutes = new Hono<AppEnv>()
  .get("/calendar-link", async (c) => {
    const [u] = await c.get("db").select({ token: users.calendarToken }).from(users).where(eq(users.id, c.get("userId")));
    return c.json({ url: u?.token ? feedUrl(c.env, c.req.url, u.token) : null });
  })
  // Makes the link, or a new one (the old link stops working).
  .post("/calendar-link", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const token = randomToken(24);
    const [before] = await db.select({ token: users.calendarToken }).from(users).where(eq(users.id, userId));
    await db.update(users).set({ calendarToken: token }).where(eq(users.id, userId));
    await db.insert(events).values({
      userId,
      entityType: "sync",
      action: before?.token ? "settings.calendar_link_renewed" : "settings.calendar_link_created",
      summary: before?.token ? "Made a new calendar link (the old one stopped working)" : "Made a calendar link for Apple Calendar",
    });
    return c.json({ url: feedUrl(c.env, c.req.url, token) });
  })
  .delete("/calendar-link", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    await db.update(users).set({ calendarToken: null }).where(eq(users.id, userId));
    await db.insert(events).values({ userId, entityType: "sync", action: "settings.calendar_link_removed", summary: "Turned off the calendar link" });
    return c.json({ url: null });
  });
