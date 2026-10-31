// Attendance register (user request 2026-10-31, plan in docs/ATTENDANCE_PLAN.md). Phase 1: the marks of a cell, the
// month's days and its holidays (the office's own, and second Saturdays when that switch is on), and the settings.
// Dates are YYYY-MM-DD strings, months YYYY-MM.

// A cell's mark. "ch" (compensation leave for a holiday worked, tied to that holiday) comes in phase 2.
export const ATTENDANCE_MARKS = ["present", "off", "cl", "cl_half", "ch", "absent"] as const;
export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];
// What the register shows in the cell (✓ for present, like a signature; user's answers 2026-10-31).
export const MARK_SHORT: Record<AttendanceMark, string> = { present: "✓", off: "O", cl: "CL", cl_half: "½CL", ch: "CH", absent: "A" };
export const MARK_NAME: Record<AttendanceMark, string> = {
  present: "Present",
  off: "Weekly off",
  cl: "Casual leave",
  cl_half: "Half day casual leave",
  ch: "Compensation leave",
  absent: "Absent",
};
// Casual leave days a mark uses.
export const clDays = (m: AttendanceMark | null | undefined) => (m === "cl" ? 1 : m === "cl_half" ? 0.5 : 0);

export type AttendanceSettings = {
  // Every second Saturday is a holiday (Kerala Government offices).
  secondSaturday: boolean;
  // Casual leave a calendar year (KSR Part I, Appendix VII: 20).
  clPerYear: number;
};
export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = { secondSaturday: true, clPerYear: 20 };

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
// 0 = Sunday … 6 = Saturday.
export const weekdayOf = (day: string) => utc(day).getUTCDay();
export const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

// "2026-10" → ["2026-10-01", …, "2026-10-31"].
export function monthDays(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
export const monthOf = (day: string) => day.slice(0, 7);
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export const monthLabel = (month: string) => utc(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// The second Saturday of a date's month: the 8th to the 14th.
export function isSecondSaturday(day: string) {
  const d = Number(day.slice(8, 10));
  return weekdayOf(day) === 6 && d >= 8 && d <= 14;
}

// A holiday of the register: one the office set in Settings › Attendance, or a second Saturday (switch on).
export type HolidayInfo = { name: string; kind: "public" | "second_saturday" };
export function holidayOn(day: string, holidays: Map<string, string>, settings: AttendanceSettings): HolidayInfo | null {
  const set = holidays.get(day);
  if (set !== undefined) return { name: set || "Holiday", kind: "public" };
  if (settings.secondSaturday && isSecondSaturday(day)) return { name: "Second Saturday", kind: "second_saturday" };
  return null;
}
// A day that is off by itself for this employee: a holiday, or a Sunday for Sunday-off staff (weekly-off staff
// work on Sundays). Such a cell takes only Present (holiday duty).
export const offByItself = (day: string, holiday: HolidayInfo | null, offDay: "sunday" | "weekly") => !!holiday || (offDay === "sunday" && weekdayOf(day) === 0);
