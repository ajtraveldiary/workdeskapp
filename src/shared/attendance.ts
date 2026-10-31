// Attendance register (user request 2026-10-31, plan in docs/ATTENDANCE_PLAN.md). Phase 1: the marks of a cell, the
// month's days and its holidays (the office's own, and second Saturdays when that switch is on), and the settings.
// Dates are YYYY-MM-DD strings, months YYYY-MM.

// A cell's mark. "ch" is compensation leave for a holiday worked, tied to that holiday (phase 2, Mark CH).
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
  // Phase 2: CH a year by designation id (null = no limit; a post not set uses guessChLimit), and the starting
  // figures by employee id.
  chLimits: Record<string, number | null>;
  start: Record<string, StartFigures>;
  // Weekly off (the user's rules): counted days that earn an off (6), and the most days in a row without one (12).
  offEvery: number;
  maxRun: number;
};
export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = { secondSaturday: true, clPerYear: 20, chLimits: {}, start: {}, offEvery: 6, maxRun: 12 };

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

// --- Phase 2: compensation leave (CH), weekly off, starting figures ---

// Compensation leave (KSR Part I, Appendix VII Section III, as relaxed for the Health Department by G.O.(Ms)
// 43/2021/H&FWD): one CH for each holiday worked (a holiday or second Saturday of the register marked present; a
// Sunday worked by Sunday-off staff earns none, user's answer 2026-10-31), taken within 3 months of it, at most 10
// held at once, a yearly limit by post. Every CH is tied to the holiday it was earned on.
export const CH_EXPIRY_MONTHS = 3;
export const CH_HOLD_MAX = 10;
// The CH limits a year by G.O. 43/2021: nursing staff no limit (null); hospital attenders, nursing assistants and
// hospital workers 45; medical officers in charge of a PHC / CHC / FHC 15; all others 22.
export const CH_LIMIT_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: "No limit (nursing staff)" },
  { value: 45, label: "45 (attenders, nursing assistants, hospital workers)" },
  { value: 22, label: "22 (other hospital staff)" },
  { value: 15, label: "15 (MO in charge of PHC / CHC / FHC)" },
];
// A post's limit from its name until one is chosen in Settings › Attendance.
export function guessChLimit(designation: string | null | undefined): number | null {
  const d = (designation ?? "").toLowerCase();
  if (/nursing assistant|attend(er|ant)|hospital worker/.test(d)) return 45;
  if (/nurs/.test(d)) return null;
  return 22;
}
// The same day n months on, at most the month's last day ("2026-11-30" + 3 → "2027-02-28").
export function addMonths(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return t.toISOString().slice(0, 10);
}
// The last day a CH for a holiday can be taken.
export const chExpires = (holiday: string) => addMonths(holiday, CH_EXPIRY_MONTHS);
// A holiday worked whose CH isn't taken yet: available for a CH on a day after it, up to its expiry.
export type ChOpen = { employeeId: string; holiday: string; name: string; expires: string };
export const chFits = (o: { holiday: string; expires: string }, date: string) => o.holiday < date && date <= o.expires;

// Figures from before the register was kept (user's answer 2026-10-31: per employee): as on a date, the CL taken in
// that year, holidays worked whose CH is still to take, and for weekly-off staff the offs due and the days counted
// towards the next one.
export type StartFigures = { asOn: string; clTaken: number; chOpen: { date: string; name: string }[]; offsDue: number; towards: number };

// Weekly off (the user's rules, 2026-10-31): 6 counted days earn an off, carried over; more than 12 counted days in a
// row without an off is warned about (both figures can be changed in Settings › Attendance). Counted: days present (holiday duty too), CL, half-day CL, CH, and holidays not
// worked. Regular leave (EL, HPL, commuted…) and absent days count nothing and start the run again; an off is taken
// from the offs due and starts the run again; days not marked yet count nothing and keep the run.
export const OFF_EVERY = 6;
export const MAX_RUN = 12;
export type WeeklyDay = { date: string; state: "count" | "off" | "reset" | "skip" };
export function weeklyOff(days: WeeklyDay[], start?: { offsDue: number; towards: number }, figures?: { offEvery?: number; maxRun?: number }, startRun = 0) {
  const every = figures?.offEvery ?? OFF_EVERY;
  const max = figures?.maxRun ?? MAX_RUN;
  let counted = start?.towards ?? 0;
  let due = start?.offsDue ?? 0;
  let run = startRun;
  const long: string[] = [];
  for (const d of days) {
    if (d.state === "count") {
      counted++;
      run++;
      if (counted % every === 0) due++;
      if (run > max) long.push(d.date);
    } else if (d.state === "off") {
      due--;
      run = 0;
    } else if (d.state === "reset") run = 0;
  }
  return { offsDue: due, towards: counted % every, run, long };
}

// An off only once it is earned (user request 2026-10-31, "allow off only if 6 duty + CL + CH completed"): the days
// as weeklyOff counts them, with the days asked for as offs (`asked`, and `was`: the day's state without the off). An
// asked off is allowed while an off is due before it; otherwise it is refused, with the days still to count for one
// (`need`), and the day keeps its own state.
export type OffCheckDay = WeeklyDay & { asked?: boolean; was?: WeeklyDay["state"] };
export function offsEarned(days: OffCheckDay[], start?: { offsDue: number; towards: number }, figures?: { offEvery?: number }) {
  const every = figures?.offEvery ?? OFF_EVERY;
  let counted = start?.towards ?? 0;
  let due = start?.offsDue ?? 0;
  const ok: string[] = [];
  const refused = new Map<string, number>();
  for (const d of days) {
    let state = d.state;
    if (d.asked) {
      if (due >= 1) ok.push(d.date);
      else {
        refused.set(d.date, dutyForOff(due, counted % every, every));
        state = d.was ?? "skip";
      }
    }
    if (state === "count") {
      counted++;
      if (counted % every === 0) due++;
    } else if (state === "off") due--;
  }
  return { ok, refused };
}
// Days of duty (present, CL, CH…) still to count before an off can be taken: none while one is due.
export const dutyForOff = (offsDue: number, towards: number, every: number) => (offsDue >= 1 ? 0 : (1 - offsDue) * every - towards);
// "1 off due", or "4 more days for an off".
export function offLine(w: { offsDue: number; towards: number }, every: number) {
  const need = dutyForOff(w.offsDue, w.towards, every);
  return need === 0 ? `${w.offsDue} ${w.offsDue === 1 ? "off" : "offs"} due` : `${need} more ${need === 1 ? "day" : "days"} for an off`;
}

// The days of a run of absence (KSR Appendix VII: CL or CH with the holidays around it, at most 15 days in a row):
// CL, CH, a weekly off, and a holiday or Sunday-off staff's Sunday not worked.
export const CL_RUN_MAX = 15;
export const awayDay = (mark: AttendanceMark | null | undefined, offItself: boolean) => mark === "cl" || mark === "ch" || mark === "off" || (offItself && !mark);

// --- Phase 3: the month's summary (the register's foot, its CSV and the assistants) ---

// Each person's month: days present (holiday duty apart), CL (half days ½), CH, offs, absent, days of leave from the
// Leave page, and working days up to today not marked yet.
export type MonthCounts = { employeeId: string; present: number; holidayDuty: number; cl: number; ch: number; off: number; absent: number; leave: number; notMarked: number };
export function monthCounts(m: {
  today: string;
  days: { date: string; holiday: HolidayInfo | null }[];
  employees: { id: string; offDay: "sunday" | "weekly"; from: string | null; until: string | null }[];
  marks: { employeeId: string; date: string; mark: AttendanceMark }[];
  leaves: { employeeId: string; from: string; to: string }[];
}): MonthCounts[] {
  const marks = new Map(m.marks.map((x) => [`${x.employeeId}|${x.date}`, x.mark]));
  return m.employees.map((e) => {
    const c: MonthCounts = { employeeId: e.id, present: 0, holidayDuty: 0, cl: 0, ch: 0, off: 0, absent: 0, leave: 0, notMarked: 0 };
    for (const d of m.days) {
      if ((e.from && d.date < e.from) || (e.until && d.date > e.until)) continue;
      if (m.leaves.some((l) => l.employeeId === e.id && l.from <= d.date && d.date <= l.to)) {
        c.leave++;
        continue;
      }
      const mark = marks.get(`${e.id}|${d.date}`);
      if (mark === "present") d.holiday ? c.holidayDuty++ : c.present++;
      else if (mark === "cl" || mark === "cl_half") c.cl += clDays(mark);
      else if (mark === "ch") c.ch++;
      else if (mark === "off") c.off++;
      else if (mark === "absent") c.absent++;
      else if (!offByItself(d.date, d.holiday, e.offDay) && d.date <= m.today) c.notMarked++;
    }
    return c;
  });
}
