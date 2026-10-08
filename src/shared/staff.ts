// Staff of the office (user request 2026-10-07): what a task or reminder can be about, and the starting list
// of designations ("Add common designations" on the Staff page; every one can be renamed or removed).
export const RELATED_KINDS = ["employee", "designation", "office"] as const;
export type RelatedKind = (typeof RELATED_KINDS)[number];

export const EMPLOYEE_CATEGORIES = ["General", "OBC", "OEC", "SC", "ST", "EWS", "Other"] as const;

// Temporary employees (user request 2026-10-07): how they are engaged, and the starting list of types (who
// engages or pays them; edited in Settings > Employees).
export const ENGAGEMENTS = ["contract", "daily_wage", "temporary"] as const;
export type Engagement = (typeof ENGAGEMENTS)[number];
export const ENGAGEMENT_LABELS: Record<Engagement, string> = { contract: "Contract", daily_wage: "Daily wage", temporary: "Temporary" };
export const COMMON_EMPLOYEE_TYPES = ["HMC", "NHM", "Block Panchayath Project", "Gramapanchayath Project"];

// A contract's last day from its first day and length in days (both days count: 179 days from 1 Oct end on
// 28 Mar).
export function contractEnd(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

// Posts commonly found in a Kerala Health Services office or hospital, senior first.
export const COMMON_DESIGNATIONS = [
  "Medical Officer",
  "Dental Surgeon",
  "Head Nurse",
  "Staff Nurse",
  "Public Health Nurse",
  "Lady Health Supervisor",
  "Health Supervisor",
  "Health Inspector",
  "Junior Public Health Nurse (JPHN)",
  "Junior Health Inspector (JHI)",
  "Pharmacist",
  "Lab Technician",
  "Radiographer",
  "Head Clerk",
  "Senior Clerk",
  "Clerk",
  "Typist",
  "Nursing Assistant",
  "Hospital Attendant",
  "Office Attendant",
  "Driver",
  "Part-time Sweeper",
];

// --- Increments (user request 2026-10-07) ---
// An employee's next increment is due in its month: the Staff page lists those due this month or earlier (not
// yet marked done); Home's Due Today shows them from the 20th of the month (earlier months' ones always).
// Marking one done moves the date a year on.

const monthEnd = (day: string) => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};

export const INCREMENT_HOME_FROM_DAY = 20;

// Due this month or before (and still not marked done).
export const incrementDue = (next: string | null, today: string) => !!next && next <= monthEnd(today);
export const incrementOverdue = (next: string | null, today: string) => !!next && next < `${today.slice(0, 7)}-01`;
// On Home's Due Today: this month's from the 20th, earlier months' always.
export const incrementOnHome = (next: string | null, today: string) =>
  incrementOverdue(next, today) || (incrementDue(next, today) && Number(today.slice(8, 10)) >= INCREMENT_HOME_FROM_DAY);

// The same day a year later (29 Feb → 28 Feb).
export function nextYear(day: string): string {
  const y = Number(day.slice(0, 4)) + 1;
  const m = day.slice(5, 7);
  const last = Number(monthEnd(`${y}-${m}-01`).slice(8, 10));
  return `${y}-${m}-${String(Math.min(Number(day.slice(8, 10)), last)).padStart(2, "0")}`;
}

// --- Contract endings (user request 2026-10-08) ---
// From 7 days before a temporary employee's contract end date (engagedTill), WorkDesk makes a "Contract ends"
// task due on that date (server/lib/contracts.ts); ticking it asks Renew for the same number of days again (the
// contract period) or Contract ended (left the office on the end date).

export const CONTRACT_HOME_DAYS = 7;
export const contractTaskTitle = (name: string) => `Contract ends: ${name}`;

const plusDays = (day: string, n: number) => contractEnd(day, n + 1);

// On Home's Due Today: ending within the next 7 days, today, or already past.
export const contractOnHome = (end: string | null, today: string) => !!end && end <= plusDays(today, CONTRACT_HOME_DAYS);
export const contractOver = (end: string | null, today: string) => !!end && end < today;
// Renewed for the same period: the new contract starts the day after the old one ends.
export const renewedEnd = (end: string, days: number) => contractEnd(plusDays(end, 1), days);

// --- Retiring within 12 months (user request 2026-10-08) ---
// The pension application should go in at least a year before retirement (AG Kerala), so 12 months before an
// employee retires WorkDesk makes a "Pension papers" task about them, due on that date, with the checklist
// below; the Employees page lists everyone retiring within 12 months.

// The same day a year earlier (29 Feb → 28 Feb).
export function yearBefore(day: string): string {
  const y = Number(day.slice(0, 4)) - 1;
  const m = day.slice(5, 7);
  const last = Number(monthEnd(`${y}-${m}-01`).slice(8, 10));
  return `${y}-${m}-${String(Math.min(Number(day.slice(8, 10)), last)).padStart(2, "0")}`;
}

// Retires within the next 12 months (or already past the date while still in the office).
export const retiringSoon = (retiresOn: string | null, today: string) => !!retiresOn && retiresOn <= nextYear(today);

export const pensionTaskTitle = (name: string) => `Pension papers: ${name}`;

// The steps of a pension application (AG Kerala's checklist for the online application via PRISM).
export const PENSION_CHECKLIST = [
  "Service book updated and attested",
  "Pension application entered in PRISM",
  "Joint photo with spouse",
  "Identification particulars",
  "Specimen signature",
  "Nomination for lifetime arrears, gratuity and commutation",
  "Details of family",
  "Declaration in Form 117-A",
  "Forwarded to the pension sanctioning authority",
];

// --- Probation pending (user request 2026-10-08) ---
// Probation is normally declared after 2 years of service. From 7 days before a permanent employee completes 2
// years from joining service, with no probation declared date, WorkDesk makes a task "Probation declaration:
// <name>" due on that date (server/lib/probation.ts). Ticking it asks: Probation declared (records today's date)
// or Change due date (e.g. probation extended by leave). Only for 2-year dates in the last
// PROBATION_LOOKBACK_YEARS years, so old staff whose declaration date was never entered don't each get a task.
export const PROBATION_YEARS = 2;
export const PROBATION_LOOKBACK_YEARS = 2;
export const probationDue = (joinedServiceOn: string) => nextYear(nextYear(joinedServiceOn));
export const probationTaskTitle = (name: string) => `Probation declaration: ${name}`;
