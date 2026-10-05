// Reporting-period arithmetic, shared by the server (task generation) and the browser (previews).
// Dates are YYYY-MM-DD strings. Months are handled as a single index: year * 12 + (month - 1).

export type Frequency = "monthly" | "quarterly" | "half_yearly" | "annual";

export type ScheduleRule = {
  frequency: Frequency;
  dueDay: number; // 1-31; clamped to the month's last day
  dueMonthOffset: number; // 0 = due in the period's last month, 1 = the month after, ...
  yearStartMonth: number; // 1-12; where quarters, halves and years begin
};

export type Period = { periodStart: string; periodEnd: string; dueDate: string; label: string };

export const PERIOD_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  annual: "Annual",
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");

export const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
const yearOf = (mi: number) => Math.floor(mi / 12);
const monthOf = (mi: number) => (mi % 12) + 1; // 1-12
const daysIn = (mi: number) => new Date(Date.UTC(yearOf(mi), monthOf(mi), 0)).getUTCDate();
const firstDay = (mi: number) => `${yearOf(mi)}-${pad(monthOf(mi))}-01`;
const lastDay = (mi: number) => `${yearOf(mi)}-${pad(monthOf(mi))}-${pad(daysIn(mi))}`;

// The start month of the period that contains month `mi`.
export function alignStart(rule: ScheduleRule, mi: number): number {
  const n = PERIOD_MONTHS[rule.frequency];
  if (n === 1) return mi;
  const shift = rule.yearStartMonth - 1;
  return mi - ((((mi - shift) % n) + n) % n);
}

function financialYear(rule: ScheduleRule, mi: number) {
  const y = yearOf(mi);
  return monthOf(mi) >= rule.yearStartMonth ? y : y - 1;
}

function yearLabel(rule: ScheduleRule, mi: number) {
  if (rule.yearStartMonth === 1) return String(yearOf(mi));
  const fy = financialYear(rule, mi);
  return `FY ${fy}-${pad((fy + 1) % 100)}`;
}

export function periodLabel(rule: ScheduleRule, startMi: number): string {
  const n = PERIOD_MONTHS[rule.frequency];
  if (n === 1) return `${MONTH_SHORT[monthOf(startMi) - 1]} ${yearOf(startMi)}`;
  if (n === 12) return yearLabel(rule, startMi);
  const index = Math.floor(((monthOf(startMi) - rule.yearStartMonth + 12) % 12) / n) + 1;
  return `${n === 3 ? "Q" : "H"}${index} ${yearLabel(rule, startMi)}`;
}

// Short form for tight spaces: "Sep", "Q2", "H1", "FY 25-26" / "2026".
export function shortLabel(rule: ScheduleRule, startMi: number): string {
  const n = PERIOD_MONTHS[rule.frequency];
  if (n === 1) return MONTH_SHORT[monthOf(startMi) - 1]!;
  if (n === 12) {
    if (rule.yearStartMonth === 1) return String(yearOf(startMi));
    const fy = financialYear(rule, startMi);
    return `FY ${pad(fy % 100)}-${pad((fy + 1) % 100)}`;
  }
  return periodLabel(rule, startMi).split(" ")[0]!;
}

export function periodAt(rule: ScheduleRule, startMi: number): Period {
  const endMi = startMi + PERIOD_MONTHS[rule.frequency] - 1;
  const dueMi = endMi + rule.dueMonthOffset;
  const day = Math.min(Math.max(rule.dueDay, 1), daysIn(dueMi));
  return {
    periodStart: firstDay(startMi),
    periodEnd: lastDay(endMi),
    dueDate: `${yearOf(dueMi)}-${pad(monthOf(dueMi))}-${pad(day)}`,
    label: periodLabel(rule, startMi),
  };
}

// Periods from `firstPeriodStart` onwards, as long as `keep` says so (bounded by `max`).
export function periodsFrom(rule: ScheduleRule, firstPeriodStart: string, keep: (p: Period) => boolean, max = 120): Period[] {
  const n = PERIOD_MONTHS[rule.frequency];
  const out: Period[] = [];
  for (let mi = alignStart(rule, monthIndex(firstPeriodStart)), i = 0; i < max; mi += n, i++) {
    const p = periodAt(rule, mi);
    if (!keep(p)) break;
    out.push(p);
  }
  return out;
}

// Default first period for a new report: the earliest period that isn't due yet.
export function defaultFirstPeriod(rule: ScheduleRule, today: string): string {
  const n = PERIOD_MONTHS[rule.frequency];
  let mi = alignStart(rule, monthIndex(today));
  while (periodAt(rule, mi - n).dueDate >= today) mi -= n;
  while (periodAt(rule, mi).dueDate < today) mi += n;
  return firstDay(mi);
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

// "Due on the 5th of the month after each period ends"
export function ruleText(rule: ScheduleRule): string {
  const day = rule.dueDay >= 31 ? "last day" : ordinal(rule.dueDay);
  const when =
    rule.dueMonthOffset === 0
      ? rule.frequency === "monthly"
        ? "of the same month"
        : "of the period's last month"
      : rule.dueMonthOffset === 1
        ? rule.frequency === "monthly"
          ? "of the following month"
          : "of the month after the period ends"
        : `of the ${ordinal(rule.dueMonthOffset)} month after the period ends`;
  const year = rule.frequency !== "monthly" && rule.yearStartMonth !== 1 ? ` (year starts in ${MONTH_LONG[rule.yearStartMonth - 1]})` : "";
  return `Due on the ${day} ${when}${year}`;
}
