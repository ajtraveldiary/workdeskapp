// Events (user request 2026-10-11): the rows as the app sees them, today's occurrences (Home, notifications), and
// "Prepare" tasks. An event with prepDays gets one task per occurrence in the next PREP_AHEAD days, due prepDays
// before it; a cancelled occurrence's open task is removed, a moved one's due date follows, and open tasks keep the
// event's title and tags. Completed prep tasks are never touched or recreated. Runs after every event change, in
// `maintain` and from the cron.
import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import type { DB } from "../db";
import { eventTypes, events, officeEvents, tasks } from "../db/schema";
import { eventOccurrences, eventTypeLabel, shiftDay, type EventRule } from "../../shared/eventSchedule";
import { dayLabel } from "../../shared/reminderSchedule";
import type { EventToday, OfficeEvent } from "../../shared/types";

export const PREP_AHEAD = 30;

type Row = typeof officeEvents.$inferSelect;
// An event row with its type's name ("" without a type; Settings > Events, user request 2026-10-12).
export type EventRow = Row & { typeName: string };

// Events matching `where`, each with its type's name (one query).
export async function loadEvents(db: DB, where: SQL | undefined): Promise<EventRow[]> {
  const rows = await db.select({ e: officeEvents, typeName: eventTypes.name }).from(officeEvents).leftJoin(eventTypes, eq(eventTypes.id, officeEvents.typeId)).where(where);
  return rows.map((r) => ({ ...r.e, typeName: r.typeName ?? "" }));
}

export const toEvent = (e: EventRow): OfficeEvent => ({
  id: e.id,
  title: e.title,
  typeId: e.typeId,
  typeName: e.typeName,
  startDate: e.startDate,
  dueDay: e.dueDay,
  startTime: e.startTime,
  endTime: e.endTime,
  repeat: e.repeat,
  endDate: e.endDate,
  venue: e.venue,
  meetingUrl: e.meetingUrl,
  organiser: e.organiser,
  attendeeIds: e.attendeeIds ?? [],
  notes: e.notes,
  links: e.links ?? [],
  tagIds: e.tagIds ?? [],
  threadId: e.threadId,
  prepDays: e.prepDays,
  changes: e.changes ?? [],
  updatedAt: e.updatedAt.toISOString(),
});

export const ruleOf = (e: Pick<Row, "repeat" | "startDate" | "dueDay" | "endDate" | "startTime" | "endTime" | "changes">): EventRule => ({
  repeat: e.repeat,
  startDate: e.startDate,
  dueDay: e.dueDay,
  endDate: e.endDate,
  startTime: e.startTime,
  endTime: e.endTime,
  changes: e.changes ?? [],
});

export const prepTitle = (title: string) => `Prepare: ${title}`;

// Today's occurrences of every event, in time order.
export async function eventsToday(db: DB, userId: string, today: string): Promise<EventToday[]> {
  const rows = await loadEvents(db, eq(officeEvents.userId, userId));
  return rows
    .flatMap((e) => eventOccurrences(ruleOf(e), today, today).map((o) => ({ ...o, id: e.id, title: e.title, typeName: e.typeName, venue: e.venue, meetingUrl: e.meetingUrl })))
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

const prepNotes = (e: EventRow, day: string, time: string | null) =>
  [`${eventTypeLabel(e.typeName)} on ${dayLabel(day)}${time ? ` at ${time}` : ""}`, e.venue && `Venue: ${e.venue}`, e.organiser && `Organised by: ${e.organiser}`].filter(Boolean).join("\n");

export async function ensureEventTasks(db: DB, today: string, userId?: string) {
  const list = await loadEvents(db, and(isNotNull(officeEvents.prepDays), userId ? eq(officeEvents.userId, userId) : undefined));
  const ids = list.map((e) => e.id);
  const existing = ids.length
    ? await db
        .select({ id: tasks.id, eventId: tasks.eventId, eventDate: tasks.eventDate, status: tasks.status, dueDate: tasks.dueDate, title: tasks.title, tagIds: tasks.tagIds })
        .from(tasks)
        .where(inArray(tasks.eventId, ids))
    : [];
  // Open prep tasks of events that no longer want one (prepDays cleared) are handled by the event routes.
  const make: (typeof tasks.$inferInsert)[] = [];
  const drop: { id: string; userId: string; title: string }[] = [];
  for (const e of list) {
    const prep = e.prepDays!;
    // Occurrences whose prep task is due from today on, up to PREP_AHEAD days away.
    const occ = eventOccurrences(ruleOf(e), today, shiftDay(today, PREP_AHEAD + prep));
    const mine = existing.filter((t) => t.eventId === e.id);
    for (const o of occ) {
      const task = mine.find((t) => t.eventDate === o.original);
      const due = shiftDay(o.date, -prep) < today ? today : shiftDay(o.date, -prep);
      if (o.status === "cancelled") {
        if (task?.status === "open") drop.push({ id: task.id, userId: e.userId, title: task.title });
        continue;
      }
      if (!task) {
        if (o.status === "scheduled")
          make.push({ userId: e.userId, title: prepTitle(e.title), notes: prepNotes(e, o.date, o.startTime), dueDate: due, priority: "normal", tagIds: e.tagIds ?? [], eventId: e.id, eventDate: o.original });
        continue;
      }
      if (task.status !== "open") continue;
      // Follow a moved date, a renamed event and changed tags.
      const set: Partial<typeof tasks.$inferInsert> = {};
      if (task.dueDate !== due && o.moved) set.dueDate = due;
      if (task.title !== prepTitle(e.title)) set.title = prepTitle(e.title);
      if ((task.tagIds ?? []).join() !== (e.tagIds ?? []).join()) set.tagIds = e.tagIds ?? [];
      if (Object.keys(set).length) await db.update(tasks).set({ ...set, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    }
  }
  if (drop.length) {
    await db.delete(tasks).where(inArray(tasks.id, drop.map((d) => d.id)));
    await db.insert(events).values(drop.map((d) => ({ userId: d.userId, entityType: "task" as const, entityId: d.id, action: "task.deleted", summary: "Removed: its event was cancelled", detail: { title: d.title } })));
  }
  if (make.length) {
    const made = await db.insert(tasks).values(make).returning({ id: tasks.id, userId: tasks.userId, title: tasks.title });
    await db.insert(events).values(made.map((t) => ({ userId: t.userId, entityType: "task" as const, entityId: t.id, action: "task.created", summary: "Made for an event", detail: { title: t.title } })));
  }
}

// Open prep tasks of one event, for when the event is deleted or no longer wants them.
export async function dropOpenPrepTasks(db: DB, eventId: string) {
  return db.delete(tasks).where(and(eq(tasks.eventId, eventId), eq(tasks.status, "open"))).returning({ id: tasks.id, title: tasks.title });
}
