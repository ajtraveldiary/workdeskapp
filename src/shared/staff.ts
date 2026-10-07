// Staff of the office (user request 2026-10-07): what a task or reminder can be about, and the starting list
// of designations ("Add common designations" on the Staff page; every one can be renamed or removed).
export const RELATED_KINDS = ["employee", "designation", "office"] as const;
export type RelatedKind = (typeof RELATED_KINDS)[number];

export const EMPLOYEE_CATEGORIES = ["General", "OBC", "OEC", "SC", "ST", "EWS", "Other"] as const;

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
