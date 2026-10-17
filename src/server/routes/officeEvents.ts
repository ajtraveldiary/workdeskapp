// Events: meetings, trainings, programmes (user request 2026-10-11). Mounted at /api/office-events (`events` is
// the History audit trail). Only WorkDesk's database changes; every change goes in History. "Make event" from an
// email moves the email out of Pending to state "event" (a new reply brings it back), or, when a prep task is
// asked for, makes the first prep task from the email (state "task") as Create task would.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { emailThreads, employees, eventTypes, events, linkedEmails, officeEvents, tasks } from "../db/schema";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";
import { dropOpenPrepTasks, ensureEventTasks, loadEvents, prepTitle, ruleOf, toEvent } from "../lib/officeEvents";
import { reconcileThreadLabels } from "../lib/taskLabels";
import { eventInput, eventPatch, occurrenceInput } from "../../shared/schemas";
import { eventOccurrences, eventTypeLabel, isOccurrence, shiftDay } from "../../shared/eventSchedule";
import { dayLabel } from "../../shared/reminderSchedule";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });
const dueDayOf = (startDate: string) => Number(startDate.slice(8, 10));

async function load(db: DB, userId: string, id: string) {
  const [e] = await db.select().from(officeEvents).where(and(eq(officeEvents.id, id), eq(officeEvents.userId, userId)));
  if (!e) throw new HTTPException(404, { message: "Event not found" });
  return e;
}

// The type must be one of this user's (Settings > Events); its name, "" for none.
async function checkType(db: DB, userId: string, id: string | null | undefined) {
  if (!id) return "";
  const [t] = await db.select({ name: eventTypes.name }).from(eventTypes).where(and(eq(eventTypes.id, id), eq(eventTypes.userId, userId)));
  if (!t) throw new HTTPException(400, { message: "Unknown event type" });
  return t.name;
}

// Attendees must be this user's employees; each once, in the order given.
async function checkAttendees(db: DB, userId: string, ids: string[] | undefined) {
  if (ids === undefined) return undefined;
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.userId, userId), inArray(employees.id, unique)));
  if (found.length !== unique.length) throw new HTTPException(400, { message: "Unknown employee" });
  return unique;
}

export const officeEventRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await loadEvents(c.get("db"), eq(officeEvents.userId, c.get("userId")));
    rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    return c.json({ events: rows.map(toEvent), today: todayIn(timezone(c.env)) });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const today = todayIn(timezone(c.env));
    const { threadId, ...input } = eventInput.parse(await c.req.json());
    const typeName = await checkType(db, userId, input.typeId);
    input.attendeeIds = (await checkAttendees(db, userId, input.attendeeIds))!;
    const thread = threadId ? (await db.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), eq(emailThreads.userId, userId))))[0] : undefined;
    if (threadId && !thread) throw new HTTPException(404, { message: "Email not found" });
    const [e] = await db.insert(officeEvents).values({ ...input, userId, dueDay: dueDayOf(input.startDate), threadId: thread?.id ?? null }).returning();
    await log(db, userId, "office_events.added", `Event added: ${e!.title} (${eventTypeLabel(typeName)}, ${dayLabel(e!.startDate)})`);

    if (thread) {
      const now = new Date();
      // With a prep task, the email becomes that task's email (as Create task); otherwise it is "event".
      const first = e!.prepDays !== null ? eventOccurrences(ruleOf(e!), today, shiftDay(today, 3660)).find((o) => o.status === "scheduled") : undefined;
      if (first) {
        const due = shiftDay(first.date, -e!.prepDays!) < today ? today : shiftDay(first.date, -e!.prepDays!);
        const [t] = await db
          .insert(tasks)
          .values({ userId, title: prepTitle(e!.title), dueDate: due, threadId: thread.id, eventId: e!.id, eventDate: first.original })
          .returning();
        await db.update(emailThreads).set({ state: "task", hasNewActivity: false, snoozedUntil: null, stateChangedAt: now, updatedAt: now }).where(eq(emailThreads.id, thread.id));
        await db.insert(events).values([
          { userId, entityType: "email", entityId: thread.id, action: "email.converted", summary: "Made into an event, with a task to prepare", detail: { subject: thread.subject } },
          { userId, entityType: "task", entityId: t!.id, action: "task.created", summary: "Made for an event, from an email", detail: { title: t!.title, subject: thread.subject } },
        ]);
        await reconcileThreadLabels(db, c.env, userId, [thread.id]).catch(() => undefined);
      } else {
        await db.update(emailThreads).set({ state: "event", hasNewActivity: false, snoozedUntil: null, stateChangedAt: now, updatedAt: now }).where(eq(emailThreads.id, thread.id));
        await db.insert(events).values({ userId, entityType: "email", entityId: thread.id, action: "email.event", summary: `Made into an event: ${e!.title}`, detail: { subject: thread.subject } });
      }
    }
    await ensureEventTasks(db, today, userId);
    return c.json(toEvent({ ...e!, typeName }), 201);
  })

  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await load(db, userId, c.req.param("id"));
    const input = eventPatch.parse(await c.req.json());
    const merged = { ...e, ...input };
    if (merged.endTime && (!merged.startTime || merged.endTime <= merged.startTime)) throw new HTTPException(400, { message: "The end time must be after the start time" });
    if (input.typeId) await checkType(db, userId, input.typeId);
    if (input.attendeeIds !== undefined) input.attendeeIds = await checkAttendees(db, userId, input.attendeeIds);
    await db
      .update(officeEvents)
      .set({ ...input, ...(input.startDate ? { dueDay: dueDayOf(input.startDate) } : {}), updatedAt: new Date() })
      .where(eq(officeEvents.id, e.id));
    // No prep task wanted any more: open ones go.
    if (input.prepDays === null && e.prepDays !== null) await dropOpenPrepTasks(db, e.id);
    await log(db, userId, "office_events.changed", `Event changed: ${merged.title}`);
    await ensureEventTasks(db, todayIn(timezone(c.env)), userId);
    return c.json({ ok: true });
  })

  // Its open prep tasks go with it (completed ones stay in History); an email kept as "event" goes back to Pending.
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await load(db, userId, c.req.param("id"));
    // Emails added to it (user request 2026-10-17), read before the links go with it.
    const added = (await db.select({ threadId: linkedEmails.threadId }).from(linkedEmails).where(eq(linkedEmails.eventId, e.id))).map((x) => x.threadId);
    await dropOpenPrepTasks(db, e.id);
    await db.delete(officeEvents).where(eq(officeEvents.id, e.id));
    await log(db, userId, "office_events.deleted", `Event deleted: ${e.title}`);
    const emails = [...new Set([e.threadId, ...added].filter((x): x is string => !!x))];
    if (emails.length) {
      const back = await db
        .update(emailThreads)
        .set({ state: "needs_decision", stateChangedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(emailThreads.id, emails), eq(emailThreads.state, "event")))
        .returning({ id: emailThreads.id, subject: emailThreads.subject });
      for (const t of back) await db.insert(events).values({ userId, entityType: "email", entityId: t.id, action: "email.returned", summary: "Its event was deleted; back to Pending", detail: { subject: t.subject } });
    }
    return c.json({ ok: true });
  })

  // One occurrence, by its scheduled day: done, cancelled, moved (postponed), or back to scheduled.
  .post("/:id/occurrence", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await load(db, userId, c.req.param("id"));
    const input = occurrenceInput.parse(await c.req.json());
    if (!isOccurrence(ruleOf(e), input.date)) throw new HTTPException(400, { message: "The event isn't on that day" });
    const prev = (e.changes ?? []).find((x) => x.date === input.date);
    const rest = (e.changes ?? []).filter((x) => x.date !== input.date);
    // A move is kept when the date is then marked done or cancelled, or set back to scheduled.
    const keptMove = prev?.newDate ? { newDate: prev.newDate, ...(prev.newTime !== undefined ? { newTime: prev.newTime } : {}), ...(prev.newEndTime !== undefined ? { newEndTime: prev.newEndTime } : {}) } : null;
    const change =
      input.status === "original"
        ? null
        : input.status === "moved"
          ? { date: input.date, status: "moved" as const, newDate: input.newDate!, ...(input.newTime !== undefined ? { newTime: input.newTime } : {}), ...(input.newEndTime !== undefined ? { newEndTime: input.newEndTime } : {}) }
          : input.status === "scheduled"
            ? keptMove && { date: input.date, status: "moved" as const, ...keptMove }
            : { date: input.date, status: input.status, ...(keptMove ?? {}) };
    await db
      .update(officeEvents)
      .set({ changes: change ? [...rest, change] : rest, updatedAt: new Date() })
      .where(eq(officeEvents.id, e.id));
    const what =
      input.status === "done"
        ? "done"
        : input.status === "cancelled"
          ? "cancelled"
          : input.status === "moved"
            ? `moved to ${dayLabel(input.newDate!)}${input.newTime ? ` ${input.newTime}` : ""}`
            : input.status === "original"
              ? "back on its own date"
              : "back to scheduled";
    await log(db, userId, `office_events.${input.status}`, `Event ${what}: ${e.title} (${dayLabel(input.date)})`);
    await ensureEventTasks(db, todayIn(timezone(c.env)), userId);
    return c.json({ ok: true });
  });
