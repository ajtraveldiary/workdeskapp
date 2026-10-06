// Reminder schedule maths, shared by the server (task generation) and the browser (previews).
// Reminders replaced recurring reports (user request 2026-10-06): a date, an optional time and a standard
// "Repeat" choice, like the add-reminder screen of phone apps. Dates are YYYY-MM-DD strings.

export const REPEATS = ["never", "daily", "weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];

export const REPEAT_LABEL: Record<Repeat, string> = {
  never: "Never",
  daily: "Every day",
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every 3 months",
  half_yearly: "Every 6 months",
  yearly: "Every year",
};

export type ReminderRule = {
  repeat: Repeat;
  startDate: string; // the first occurrence
  // Day of the month for monthly and longer repeats (31 = the last day). Kept apart from startDate so a
  // reminder on the 31st stays on the last day after a short month.
  dueDay: number;
  endDate: string | null; // no occurrences after this day
};

const STEP_DAYS: Partial<Record<Repeat, number>> = { daily: 1, weekly: 7, biweekly: 14 };
const STEP_MONTHS: Partial<Record<Repeat, number>> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const shift = (day: string, days: number) => {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Months as one index: year * 12 + (month - 1).
const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
const daysIn = (mi: number) => new Date(Date.UTC(Math.floor(mi / 12), (mi % 12) + 1, 0)).getUTCDate();

// The i-th occurrence (0 = the start date).
export function occurrenceAt(rule: ReminderRule, i: number): string {
  if (i === 0 || rule.repeat === "never") return rule.startDate;
  const days = STEP_DAYS[rule.repeat];
  if (days) return shift(rule.startDate, days * i);
  const mi = monthIndex(rule.startDate) + STEP_MONTHS[rule.repeat]! * i;
  const day = Math.min(Math.max(rule.dueDay, 1), daysIn(mi));
  return `${Math.floor(mi / 12)}-${pad((mi % 12) + 1)}-${pad(day)}`;
}

// Occurrences in date order while `keep` says so, stopping at the end date (bounded by `max`).
export function occurrences(rule: ReminderRule, keep: (day: string) => boolean, max = 1000): string[] {
  const out: string[] = [];
  const count = rule.repeat === "never" ? 1 : max;
  for (let i = 0; i < count; i++) {
    const day = occurrenceAt(rule, i);
    if ((rule.endDate && day > rule.endDate) || !keep(day)) break;
    out.push(day);
  }
  return out;
}

// "5 Oct 2026", the label of an occurrence.
export function dayLabel(day: string): string {
  const d = utc(day);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

// "Every month on the 5th", "Every week on Monday", "Once, on 5 Oct 2026".
export function repeatText(rule: ReminderRule): string {
  const d = utc(rule.startDate);
  const day = rule.dueDay >= 31 ? "the last day" : `the ${ordinal(rule.dueDay)}`;
  const until = rule.endDate && rule.repeat !== "never" ? `, until ${dayLabel(rule.endDate)}` : "";
  switch (rule.repeat) {
    case "never":
      return `Once, on ${dayLabel(rule.startDate)}`;
    case "daily":
      return `Every day${until}`;
    case "weekly":
    case "biweekly":
      return `${REPEAT_LABEL[rule.repeat]} on ${WEEKDAY[d.getUTCDay()]}${until}`;
    case "yearly":
      return `Every year on ${rule.dueDay >= 31 ? "the last day of" : d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}${until}`;
    default:
      return `${REPEAT_LABEL[rule.repeat]} on ${day}${until}`;
  }
}

// "Remind me" choices: how many days before the date the task appears.
export const REMIND_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: "On the day" },
  { days: 1, label: "1 day before" },
  { days: 2, label: "2 days before" },
  { days: 3, label: "3 days before" },
  { days: 7, label: "1 week before" },
  { days: 14, label: "2 weeks before" },
  { days: 30, label: "1 month before" },
];

export const remindLabel = (days: number) => REMIND_OPTIONS.find((o) => o.days === days)?.label ?? `${days} days before`;

// The first occurrence on or after `from`, or null when the reminder has none left.
export function nextOccurrence(rule: ReminderRule, from: string): string | null {
  for (let i = 0; i < 20_000; i++) {
    const day = occurrenceAt(rule, i);
    if (rule.endDate && day > rule.endDate) return null;
    if (day >= from) return day;
    if (rule.repeat === "never") return null;
  }
  return null;
}
