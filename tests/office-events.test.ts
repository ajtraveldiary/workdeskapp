// Events: meetings, trainings, programmes (user request 2026-10-11). Repeats with changes per occurrence, prep
// tasks that follow the event, "Make event" from an email, a phone note an hour before, the calendar feed and CSV.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { eventOccurrences, shiftDay, type EventRule } from "../src/shared/eventSchedule";
import { onThreadUpdate } from "../src/server/lib/threadRules";
import { planNotifications } from "../src/server/lib/notify";
import { buildCalendar } from "../src/server/lib/ics";
import type { OfficeEvent, Task, Thread } from "../src/shared/types";

describe("event dates", () => {
  const monthly: EventRule = { repeat: "monthly", startDate: "2026-11-05", dueDay: 5, endDate: "2027-02-28", startTime: "10:30", endTime: "12:00", changes: [] };
  it("repeats, stops at the end date, and applies done / cancelled / moved per occurrence", () => {
    expect(eventOccurrences(monthly, "2026-01-01", "2027-12-31").map((o) => o.date)).toEqual(["2026-11-05", "2026-12-05", "2027-01-05", "2027-02-05"]);
    const changed: EventRule = {
      ...monthly,
      changes: [
        { date: "2026-11-05", status: "done" },
        { date: "2026-12-05", status: "cancelled" },
        { date: "2027-01-05", status: "moved", newDate: "2027-01-09", newTime: "15:00" },
      ],
    };
    const occ = eventOccurrences(changed, "2026-01-01", "2027-12-31");
    expect(occ.map((o) => [o.date, o.status, o.startTime, o.moved])).toEqual([
      ["2026-11-05", "done", "10:30", false],
      ["2026-12-05", "cancelled", "10:30", false],
      ["2027-01-09", "scheduled", "15:00", true],
      ["2027-02-05", "scheduled", "10:30", false],
    ]);
    // A moved date that is then done stays on its new day.
    const movedDone: EventRule = { ...monthly, changes: [{ date: "2027-01-05", status: "done", newDate: "2027-01-09" }] };
    expect(eventOccurrences(movedDone, "2027-01-01", "2027-01-31").map((o) => [o.date, o.status, o.moved])).toEqual([["2027-01-09", "done", true]]);
    // Moved into a range from outside it, and out of one.
    expect(eventOccurrences(changed, "2027-01-08", "2027-01-10").map((o) => o.original)).toEqual(["2027-01-05"]);
    expect(eventOccurrences(changed, "2027-01-05", "2027-01-05")).toEqual([]);
  });
});

describe("events", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  let today: string;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any, text };
  };
  const list = async () => (await call("GET", "/office-events")).json.events as OfficeEvent[];
  const tasksFor = async (eventId: string) => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).filter((t) => t.eventId === eventId);
  const thread = async (id: string) => ((await call("GET", "/threads?state=all")).json.threads as Thread[]).find((t) => t.id === id)!;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
    today = (await call("GET", "/me")).json.today;
  });

  it("are added with attendees and tags, and checked", async () => {
    const emp = (await call("POST", "/staff/employees", { name: "Training Attendee" })).json.id as string;
    const tag = (await call("POST", "/tags", { name: "Training" })).json.id as string;
    const res = await call("POST", "/office-events", { title: "Fire safety training", kind: "training", startDate: shiftDay(today, 3), startTime: "09:30", endTime: "16:00", venue: "Training centre", attendeeIds: [emp], tagIds: [tag] });
    expect(res.status).toBe(201);
    const [e] = await list();
    expect([e!.title, e!.kind, e!.venue, e!.attendeeIds, e!.tagIds]).toEqual(["Fire safety training", "training", "Training centre", [emp], [tag]]);
    expect((await call("POST", "/office-events", { title: "x", startDate: today, startTime: "10:00", endTime: "09:00" })).status).toBe(400);
    expect((await call("POST", "/office-events", { title: "x", startDate: today, attendeeIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(400);
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((h) => h.summary);
    expect(history.some((s) => s.startsWith("Event added: Fire safety training"))).toBe(true);
  });

  it("make a prep task that follows cancel, move, rename and turning it off", async () => {
    const day = shiftDay(today, 5);
    const { json: e } = await call("POST", "/office-events", { title: "Monthly review", startDate: day, startTime: "10:30", prepDays: 2 });
    let [t] = await tasksFor(e.id);
    expect([t!.title, t!.dueDate, t!.eventDate]).toEqual(["Prepare: Monthly review", shiftDay(day, -2), day]);

    await call("POST", `/office-events/${e.id}/occurrence`, { date: day, status: "moved", newDate: shiftDay(day, 3), newTime: "15:00" });
    [t] = await tasksFor(e.id);
    expect(t!.dueDate).toBe(shiftDay(day, 1));

    await call("PATCH", `/office-events/${e.id}`, { title: "Monthly review meeting" });
    expect((await tasksFor(e.id))[0]!.title).toBe("Prepare: Monthly review meeting");

    await call("POST", `/office-events/${e.id}/occurrence`, { date: day, status: "cancelled" });
    expect(await tasksFor(e.id)).toEqual([]);
    await call("POST", `/office-events/${e.id}/occurrence`, { date: day, status: "scheduled" });
    expect(await tasksFor(e.id)).toHaveLength(1);

    await call("PATCH", `/office-events/${e.id}`, { prepDays: null });
    expect(await tasksFor(e.id)).toEqual([]);
    expect((await call("POST", `/office-events/${e.id}/occurrence`, { date: shiftDay(day, 1), status: "done" })).status).toBe(400);
  });

  it("made from an email take it out of Pending, or make its prep task; a reply or deleting brings it back", async () => {
    const pending = ((await call("GET", "/threads?state=needs_decision")).json.threads as Thread[]).slice(0, 2);
    const { json: plain } = await call("POST", "/office-events", { title: pending[0]!.subject, startDate: shiftDay(today, 4), threadId: pending[0]!.id });
    expect((await thread(pending[0]!.id)).state).toBe("event");
    const { json: withPrep } = await call("POST", "/office-events", { title: pending[1]!.subject, startDate: shiftDay(today, 6), prepDays: 1, threadId: pending[1]!.id });
    expect((await thread(pending[1]!.id)).state).toBe("task");
    const [prep] = await tasksFor(withPrep.id);
    expect(prep!.thread?.id).toBe(pending[1]!.id);

    // A new reply on the event's email: back to Pending.
    const now = new Date();
    expect(onThreadUpdate({ state: "event", lastMessageAt: new Date(now.getTime() - 60_000), hasNewActivity: false }, now, 0).state).toBe("needs_decision");
    // Deleting the event also brings it back.
    await call("DELETE", `/office-events/${plain.id}`);
    expect((await thread(pending[0]!.id)).state).toBe("needs_decision");
    await call("DELETE", `/office-events/${withPrep.id}`);
    expect(await tasksFor(withPrep.id)).toEqual([]);
  });

  it("show on Home today, in the calendar feed and in the Events CSV", async () => {
    await call("POST", "/office-events", { title: "Staff meeting today", startDate: today, startTime: "15:00", venue: "Hall" });
    const summary = (await call("GET", "/summary")).json;
    expect(summary.eventsToday.map((e: { title: string; venue: string }) => [e.title, e.venue])).toEqual([["Staff meeting today", "Hall"]]);

    const csv = (await call("GET", "/transfer/events/csv")).text;
    expect(csv.split("\n")[0]).toContain("Attendees");
    expect(csv).toContain("Staff meeting today");
    const emp = (await call("POST", "/staff/employees", { name: "CSV Person" })).json.id as string;
    const res = (await call("POST", "/transfer/events/import", { headers: ["Title", "Type", "Date", "Start time", "Attendees", "Tags"], rows: [["Induction programme", "Programme", shiftDay(today, 10), "10:00", "CSV Person", "New staff"]] })).json;
    expect(res).toMatchObject({ added: 1, problems: [] });
    const made = (await list()).find((e) => e.title === "Induction programme")!;
    expect([made.kind, made.startTime, made.attendeeIds, made.tagIds.length]).toEqual(["programme", "10:00", [emp], 1]);
    const bad = (await call("POST", "/transfer/events/import", { headers: ["Title", "Date", "Attendees"], rows: [["X", today, "Nobody Here"]] })).json;
    expect(bad.problems[0].message).toContain("no employee called");
  });
});

describe("event notes and feed", () => {
  const env = { APP_TIMEZONE: "Asia/Kolkata" };
  const at = (hm: string) => new Date(`2026-10-08T${hm}:00+05:30`);
  it("a phone note goes out within the hour before an event, once; cancelled ones never", async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    const db = d as unknown as DB;
    const userId = (await db.insert(schema.users).values({ email: "hr@example.com" }).returning())[0]!.id;
    await db.insert(schema.officeEvents).values([
      { userId, title: "Board meeting", startDate: "2026-10-08", dueDay: 8, startTime: "11:00", venue: "Board room" },
      { userId, title: "Cancelled call", startDate: "2026-10-08", dueDay: 8, startTime: "11:00", changes: [{ date: "2026-10-08", status: "cancelled" }] },
    ]);
    expect((await planNotifications(db, env, userId, at("09:30"))).messages.filter((m) => m.tag?.startsWith("event-"))).toEqual([]);
    const plan = await planNotifications(db, env, userId, at("10:30"));
    const notes = plan.messages.filter((m) => m.tag?.startsWith("event-"));
    expect(notes.map((m) => [m.title, m.body])).toEqual([["Board meeting", "Meeting at 11:00 AM (in 30 min) · Board room"]]);
    await db.update(schema.officeEvents).set({ notifiedFor: plan.eventKeys[0]!.key }).where(eq(schema.officeEvents.id, plan.eventKeys[0]!.id));
    expect((await planNotifications(db, env, userId, at("10:40"))).messages.filter((m) => m.tag?.startsWith("event-"))).toEqual([]);
  });

  it("are in the calendar feed with times, place and cancellations", () => {
    const ics = buildCalendar({
      tasks: [],
      reminders: [],
      events: [
        { id: "e1", title: "Review", kind: "meeting", venue: "Hall", meetingUrl: "", organiser: "", notes: "", repeat: "never", startDate: "2026-10-20", dueDay: 20, endDate: null, startTime: "10:00", endTime: "11:30", changes: [], updatedAt: new Date() },
        { id: "e2", title: "Call", kind: "other", venue: "", meetingUrl: "", organiser: "", notes: "", repeat: "never", startDate: "2026-10-21", dueDay: 21, endDate: null, startTime: null, endTime: null, changes: [{ date: "2026-10-21", status: "cancelled" }], updatedAt: new Date() },
      ],
      today: "2026-10-12",
      tz: "Asia/Kolkata",
      appUrl: "https://example.test",
    });
    expect(ics).toContain("DTSTART:20261020T043000Z");
    expect(ics).toContain("DTEND:20261020T060000Z");
    expect(ics).toContain("LOCATION:Hall");
    expect(ics).toContain("SUMMARY:Cancelled: Call");
    expect(ics).toContain("STATUS:CANCELLED");
  });
});
