// Phone notifications (user request 2026-10-07; the user chose: a morning summary at a time set in Settings,
// a notification at a task's or reminder's due time, and the "Pending today" count as the app icon's badge).
// Run by the cron trigger every 10 minutes after the Gmail sync, so a notification arrives within about
// 10 minutes of its time. Each device that turned notifications on is a push_subscriptions row.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db";
import { employees, officeEvents, pushSubscriptions, tasks, users } from "../db/schema";
import { EVENT_KIND_LABEL } from "../../shared/eventSchedule";
import { eventsToday } from "./officeEvents";
import { incrementOnHome } from "../../shared/staff";
import { timezone, type Env } from "../env";
import { viewFilter } from "../routes/tasks";
import { decryptSecret, encryptSecret } from "./crypto";
import { todayIn } from "./dates";
import { makeVapidKeys, sendPush, type PushMessage, type VapidKeys } from "./webpush";

// "HH:MM" (24h) now in the app's timezone.
export function timeIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const ampm = (hm: string) => {
  const h = Number(hm.slice(0, 2));
  return `${h % 12 || 12}:${hm.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
};

const DUE_WINDOW = 90; // minutes: a timed task missed for longer than this (app down) isn't notified late
const SUMMARY_WINDOW = 180; // minutes after the summary time it may still go out
const EVENT_LEAD = 60; // minutes: events are noted this long before they start (user request 2026-10-11)

// WorkDesk's VAPID key pair, made on first use. The private half is encrypted with TOKEN_ENC_KEY (local
// development without it keeps it as it is).
export async function vapidKeysFor(db: DB, env: Env, userId: string): Promise<VapidKeys> {
  const [u] = await db.select({ pub: users.vapidPublicKey, priv: users.vapidPrivateKeyEnc }).from(users).where(eq(users.id, userId));
  if (u?.pub && u.priv) {
    const json = u.priv.startsWith("plain:") ? u.priv.slice(6) : await decryptSecret(u.priv, env.TOKEN_ENC_KEY!);
    return { publicKey: u.pub, privateJwk: JSON.parse(json) as JsonWebKey };
  }
  const keys = await makeVapidKeys();
  const json = JSON.stringify(keys.privateJwk);
  const stored = env.TOKEN_ENC_KEY ? await encryptSecret(json, env.TOKEN_ENC_KEY) : `plain:${json}`;
  await db.update(users).set({ vapidPublicKey: keys.publicKey, vapidPrivateKeyEnc: stored }).where(eq(users.id, userId));
  return keys;
}

// Sends the messages to every device of the user; devices that turned notifications off are forgotten.
export async function pushToUser(db: DB, env: Env, userId: string, messages: PushMessage[], onlyEndpoint?: string): Promise<number> {
  if (!messages.length) return 0;
  const subs = (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).filter((s) => !onlyEndpoint || s.endpoint === onlyEndpoint);
  if (!subs.length) return 0;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const keys = await vapidKeysFor(db, env, userId);
  const subject = `mailto:${u?.email ?? "workdesk@example.com"}`;
  let sent = 0;
  const gone: string[] = [];
  for (const s of subs) {
    for (const m of messages) {
      const r = await sendPush(s, m, keys, subject).catch((e) => {
        console.error("Push failed:", e);
        return "failed" as const;
      });
      if (r === "gone") {
        gone.push(s.id);
        break;
      }
      if (r === "ok") sent++;
    }
  }
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  if (sent) await db.update(pushSubscriptions).set({ lastSentAt: new Date() }).where(and(eq(pushSubscriptions.userId, userId)));
  return sent;
}

type Row = { id: string; title: string; dueDate: string | null; dueTime: string | null; reportPeriodId: string | null; pushNotifiedFor: string | null };

// What is due for one user right now: the messages, plus what to remember so nothing is sent twice.
export async function planNotifications(db: DB, env: Env, userId: string, now = new Date()) {
  const tz = timezone(env);
  const today = todayIn(tz, now);
  const nowHM = timeIn(tz, now);
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return { messages: [] as PushMessage[], taskKeys: [] as { id: string; key: string }[], eventKeys: [] as { id: string; key: string }[], summaryDay: null as string | null };
  const cols = { id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, dueTime: tasks.dueTime, reportPeriodId: tasks.reportPeriodId, pushNotifiedFor: tasks.pushNotifiedFor };
  const mine = eq(tasks.userId, userId);
  const order = [asc(tasks.dueDate), asc(tasks.dueTime)];
  const [overdue, dueToday] = (await Promise.all([
    db.select(cols).from(tasks).where(and(mine, viewFilter("overdue", today))).orderBy(...order),
    db.select(cols).from(tasks).where(and(mine, viewFilter("today", today))).orderBy(...order),
  ])) as [Row[], Row[]];
  // The app icon's badge: Home's "Pending today" (due today + overdue, and increments due, user request 2026-10-07).
  // Contracts ending are tasks (user request 2026-10-08), so they are already in the task counts.
  const increments = (
    await db.select({ due: employees.nextIncrementOn }).from(employees).where(and(eq(employees.userId, userId), isNull(employees.leftOn)))
  ).filter((e) => incrementOnHome(e.due, today)).length;
  const badge = overdue.length + dueToday.length + increments;
  const messages: PushMessage[] = [];

  // At the due time: today's timed tasks and reminders whose time has come (not waiting ones: they come
  // back by their reply date, which has no time).
  const taskKeys: { id: string; key: string }[] = [];
  if (u.pushDueOn) {
    const due = dueToday.filter((t) => {
      if (!t.dueTime || t.dueDate !== today) return false;
      const late = minutes(nowHM) - minutes(t.dueTime);
      return late >= 0 && late <= DUE_WINDOW && t.pushNotifiedFor !== `${t.dueDate} ${t.dueTime}`;
    });
    for (const t of due) taskKeys.push({ id: t.id, key: `${t.dueDate} ${t.dueTime}` });
    if (due.length > 3) {
      messages.push({ title: `${due.length} tasks due now`, body: due.slice(0, 4).map((t) => `• ${t.title}`).join("\n") + (due.length > 4 ? `\n+ ${due.length - 4} more` : ""), url: "/", tag: "due", badge });
    } else {
      for (const t of due) messages.push({ title: t.title, body: `${t.reportPeriodId ? "Reminder" : "Task"} · due ${ampm(t.dueTime!)}`, url: "/", tag: `due-${t.id}`, badge });
    }
  }

  // Events an hour before they start (user request 2026-10-11): today's timed ones that aren't cancelled or done,
  // once per occurrence ("day time" remembered on the event), with the "note at the due time" setting.
  const todays = await eventsToday(db, userId, today);
  const eventKeys: { id: string; key: string }[] = [];
  if (u.pushDueOn && todays.length) {
    const sent = new Map((await db.select({ id: officeEvents.id, n: officeEvents.notifiedFor }).from(officeEvents).where(inArray(officeEvents.id, todays.map((e) => e.id)))).map((r) => [r.id, r.n]));
    for (const e of todays) {
      if (e.status !== "scheduled" || !e.startTime) continue;
      const lead = minutes(e.startTime) - minutes(nowHM);
      const key = `${e.date} ${e.startTime}`;
      if (lead < 0 || lead > EVENT_LEAD || sent.get(e.id) === key) continue;
      eventKeys.push({ id: e.id, key });
      messages.push({
        title: e.title,
        body: `${EVENT_KIND_LABEL[e.kind]} at ${ampm(e.startTime)}${lead > 0 ? ` (in ${lead} min)` : ""}${e.venue ? ` · ${e.venue}` : ""}`,
        url: "/events",
        tag: `event-${e.id}`,
        badge,
      });
    }
  }

  // The morning summary, once a day at the chosen time (or a little after, if the app was down then).
  let summaryDay: string | null = null;
  const sinceSummary = minutes(nowHM) - minutes(u.pushSummaryTime);
  if (u.pushSummaryOn && u.pushSummarySentOn !== today && sinceSummary >= 0 && sinceSummary <= SUMMARY_WINDOW) {
    summaryDay = today;
    const eventLines = todays.filter((e) => e.status !== "cancelled").map((e) => `• ${e.startTime ? `${ampm(e.startTime)} ` : ""}${e.title} (${EVENT_KIND_LABEL[e.kind].toLowerCase()})`);
    const list = [...eventLines, ...overdue.map((t) => `• ${t.title} (overdue)`), ...dueToday.map((t) => `• ${t.title}${t.dueTime ? ` · ${ampm(t.dueTime)}` : ""}`)];
    messages.push(
      badge === 0 && eventLines.length
        ? { title: `Today: ${eventLines.length} event${eventLines.length === 1 ? "" : "s"}`, body: list.slice(0, 4).join("\n") + (list.length > 4 ? `\n+ ${list.length - 4} more` : ""), url: "/", tag: "summary", badge }
        : badge === 0
        ? { title: "Nothing due today", body: "No tasks or reminders due, and nothing overdue.", url: "/", tag: "summary", badge }
        : {
            title: `Today: ${dueToday.length} due${overdue.length ? ` · ${overdue.length} overdue` : ""}${eventLines.length ? ` · ${eventLines.length} event${eventLines.length === 1 ? "" : "s"}` : ""}`,
            body: list.slice(0, 4).join("\n") + (list.length > 4 ? `\n+ ${list.length - 4} more` : ""),
            url: "/",
            tag: "summary",
            badge,
          },
    );
  }
  return { messages, taskKeys, eventKeys, summaryDay };
}

// The cron job: every user with a device that turned notifications on.
export async function sendScheduledPush(db: DB, env: Env, now = new Date()) {
  const owners = [...new Set((await db.select({ userId: pushSubscriptions.userId }).from(pushSubscriptions)).map((r) => r.userId))];
  for (const userId of owners) {
    const plan = await planNotifications(db, env, userId, now);
    if (!plan.messages.length) continue;
    // Remembered first, so a slow or failed push is never repeated every 10 minutes.
    for (const t of plan.taskKeys) await db.update(tasks).set({ pushNotifiedFor: t.key }).where(eq(tasks.id, t.id));
    for (const e of plan.eventKeys) await db.update(officeEvents).set({ notifiedFor: e.key }).where(eq(officeEvents.id, e.id));
    if (plan.summaryDay) await db.update(users).set({ pushSummarySentOn: plan.summaryDay }).where(eq(users.id, userId));
    await pushToUser(db, env, userId, plan.messages);
  }
}
