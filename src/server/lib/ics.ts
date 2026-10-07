// The private calendar feed (user request 2026-10-07: tasks and reminders in Apple Calendar). An iCalendar
// (.ics) file that Apple Calendar, Google Calendar or Outlook subscribe to by link; read-only, one way.
//  - Open tasks with a due date (not the tasks made for reminders, which show as the reminders themselves):
//    at their time (30 minutes) when they have one, otherwise all day.
//  - Reminders: every date from two months back to a year ahead, worked out with the app's own date maths;
//    dates already marked done get a ✓.
//  - Overdue (user request 2026-10-07, like the Due Today card): an open task whose date has passed, and a
//    reminder date before today that isn't done, show on today as an all-day "Overdue: …" event instead of on
//    their old date, with the old date in the details. They move along day by day until done.
import { occurrences, repeatText, type ReminderRule } from "../../shared/reminderSchedule";

export type FeedTask = {
  id: string;
  title: string;
  notes: string;
  dueDate: string;
  dueTime: string | null;
  priority: string;
  updatedAt: Date;
  email: { from: string | null; subject: string } | null;
};

export type FeedReminder = ReminderRule & {
  id: string;
  name: string;
  notes: string;
  dueTime: string | null;
  updatedAt: Date;
  doneDates: Set<string>;
  // Past dates not marked done (their tasks are still open).
  overdueDates: Set<string>;
};

const PRIORITY: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Medium", low: "Low" };
const EVENT_MINUTES = 30;
const BACK_DAYS = 60;
const AHEAD_DAYS = 366;

const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const compactDay = (day: string) => day.replaceAll("-", "");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
// "18 Sept 2026, 09:30"
const wasDue = (day: string, time: string | null) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}${time ? `, ${time}` : ""}`;

// A wall-clock time in `tz` as a UTC instant (works for any time zone, with or without summer time).
export function localToUtc(day: string, time: string, tz: string): Date {
  const guess = new Date(`${day}T${time}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

// Text values: backslash, semicolon, comma and line breaks escaped.
export const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 bytes are folded (CRLF + space), never inside a character (Malayalam is 3 bytes each).
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

function when(day: string, time: string | null, tz: string): string[] {
  if (!time) return [`DTSTART;VALUE=DATE:${compactDay(day)}`, `DTEND;VALUE=DATE:${compactDay(shift(day, 1))}`];
  const start = localToUtc(day, time, tz);
  return [`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + EVENT_MINUTES * 60_000))}`];
}

export function buildCalendar(opts: { tasks: FeedTask[]; reminders: FeedReminder[]; today: string; tz: string; appUrl: string; now?: Date }): string {
  const now = stamp(opts.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkDesk//Tasks and reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:WorkDesk",
    "X-WR-CALDESC:Tasks and reminders from WorkDesk",
    `X-WR-TIMEZONE:${opts.tz}`,
    // Ask calendar apps to check for changes every 15 minutes (each app decides in the end).
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  const event = (uid: string, updated: Date, fields: string[]) =>
    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${now}`, `LAST-MODIFIED:${stamp(updated)}`, ...fields, "TRANSP:TRANSPARENT", `URL:${opts.appUrl}`, "END:VEVENT");

  for (const t of opts.tasks) {
    const overdue = t.dueDate < opts.today;
    const about = [
      overdue ? `Overdue – was due ${wasDue(t.dueDate, t.dueTime)}` : null,
      `Priority: ${PRIORITY[t.priority] ?? t.priority}`,
      t.email ? `From email: ${t.email.from ? `${t.email.from} – ` : ""}${t.email.subject}` : null,
      t.notes.trim() ? `\n${t.notes.trim()}` : null,
      `\nOpen WorkDesk: ${opts.appUrl}`,
    ].filter(Boolean);
    event(`task-${t.id}@workdesk`, t.updatedAt, [
      ...(overdue ? when(opts.today, null, opts.tz) : when(t.dueDate, t.dueTime, opts.tz)),
      `SUMMARY:${escapeText(`${overdue ? "Overdue: " : ""}${t.title}`)}`,
      `DESCRIPTION:${escapeText(about.join("\n"))}`,
    ]);
  }

  const from = shift(opts.today, -BACK_DAYS);
  const until = shift(opts.today, AHEAD_DAYS);
  for (const r of opts.reminders) {
    const days = occurrences(r, (day) => day <= until, 2000).filter((day) => day >= from);
    // Overdue dates older than the window still come along to today.
    for (const day of [...r.overdueDates].filter((d) => d < from)) days.unshift(day);
    for (const day of days) {
      const done = r.doneDates.has(day);
      const overdue = !done && day < opts.today && r.overdueDates.has(day);
      const about = [
        overdue ? `Overdue – was due ${wasDue(day, r.dueTime)}` : null,
        `Reminder · ${repeatText(r)}`,
        r.notes.trim() ? `\n${r.notes.trim()}` : null,
        `\nOpen WorkDesk: ${opts.appUrl}`,
      ].filter(Boolean);
      event(`reminder-${r.id}-${day}@workdesk`, r.updatedAt, [
        ...(overdue ? when(opts.today, null, opts.tz) : when(day, r.dueTime, opts.tz)),
        `SUMMARY:${escapeText(`${done ? "✓ " : overdue ? "Overdue: " : ""}${r.name}`)}`,
        `DESCRIPTION:${escapeText(about.join("\n"))}`,
      ]);
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
