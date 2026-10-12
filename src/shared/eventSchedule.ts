// Events: meetings, trainings, programmes (user request 2026-10-11; user's choices: repeat like reminders, each
// occurrence done / cancelled / moved on its own, an optional preparation task, a phone note an hour before, and
// "Make event" from an email). Shared by the server (prep tasks, notifications, calendar feed, Home) and the
// browser (Events page, Calendar). Dates are YYYY-MM-DD, times HH:MM in the app's time zone.
import { occurrenceAt, type ReminderRule } from "./reminderSchedule";

export const EVENT_KINDS = ["meeting", "training", "programme", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABEL: Record<EventKind, string> = { meeting: "Meeting", training: "Training", programme: "Programme", other: "Other" };

// What happened to one occurrence, keyed by its original date. "moved" = postponed or brought forward; a moved
// occurrence that is then done or cancelled keeps its newDate / newTime.
export type EventChange = { date: string; status: "done" | "cancelled" | "moved"; newDate?: string; newTime?: string | null; newEndTime?: string | null };

export type EventRule = ReminderRule & { startTime: string | null; endTime: string | null; changes: EventChange[] };

export type EventOccurrence = {
  date: string; // the day it takes place (the new day when moved)
  original: string; // the day the schedule gave it (the key for changes and prep tasks)
  startTime: string | null;
  endTime: string | null;
  status: "scheduled" | "done" | "cancelled";
  moved: boolean;
};

// Prep task choices in the form: days before the event the task is due.
export const PREP_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: "On the day" },
  { days: 1, label: "1 day before" },
  { days: 2, label: "2 days before" },
  { days: 3, label: "3 days before" },
  { days: 7, label: "1 week before" },
  { days: 14, label: "2 weeks before" },
];

export const shiftDay = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Every occurrence that falls on a day from `from` to `to` (inclusive), with its changes applied, in time order.
// An occurrence moved into the range from outside it is included; one moved out of it is not.
export function eventOccurrences(rule: EventRule, from: string, to: string, max = 2000): EventOccurrence[] {
  const byDate = new Map(rule.changes.map((c) => [c.date, c]));
  const out: EventOccurrence[] = [];
  const seen = new Set<string>();
  const add = (original: string) => {
    if (seen.has(original)) return;
    seen.add(original);
    const ch = byDate.get(original);
    const moved = !!ch?.newDate;
    const date = moved ? ch!.newDate! : original;
    if (date < from || date > to) return;
    out.push({
      date,
      original,
      startTime: moved && ch!.newTime !== undefined ? ch!.newTime! : rule.startTime,
      endTime: moved && ch!.newEndTime !== undefined ? ch!.newEndTime! : rule.endTime,
      status: ch?.status === "done" ? "done" : ch?.status === "cancelled" ? "cancelled" : "scheduled",
      moved,
    });
  };
  const count = rule.repeat === "never" ? 1 : max;
  for (let i = 0; i < count; i++) {
    const day = occurrenceAt(rule, i);
    if ((rule.endDate && day > rule.endDate) || day > to) break;
    if (day >= from) add(day);
  }
  // Moved here from a day outside the range.
  for (const c of rule.changes) if (c.newDate && c.newDate >= from && c.newDate <= to && isOccurrence(rule, c.date)) add(c.date);
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

// Is `day` one of the event's scheduled days?
export function isOccurrence(rule: EventRule, day: string): boolean {
  if (rule.endDate && day > rule.endDate) return false;
  const count = rule.repeat === "never" ? 1 : 20_000;
  for (let i = 0; i < count; i++) {
    const d = occurrenceAt(rule, i);
    if (d === day) return true;
    if (d > day) return false;
  }
  return false;
}

// "10:30 AM – 1:00 PM", "10:30 AM", or "All day".
export function timeRange(start: string | null, end: string | null, fmt: (t: string) => string): string {
  if (!start) return "All day";
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}
