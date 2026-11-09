// Leave log (user request 2026-11-09, "a button to view a log of all leaves in chronological order, with filters for the
// type of leave and employees, and an option to print; don't include off, CH-off or holiday / SS"): every CL, half day
// CL and CH from the attendance register and every leave from the Leave page (EL, HPL, commuted, hysterectomy…), oldest
// first. Offs, holidays taken (H / SS), absent and OD are not leave and stay out; cancelled leave too.

export type LeaveLogKind = "cl" | "cl_half" | "ch" | "leave";
// One line of the log. `filter`: the type filter's value ("cl", "cl_half", "ch" or "leave:<type id>").
export type LeaveLogEntry = {
  employeeId: string;
  kind: LeaveLogKind;
  filter: string;
  type: string;
  typeName: string;
  from: string;
  to: string;
  days: number;
  details: string;
  notes: string;
};
export type LeaveLogPerson = { id: string; name: string; designation: string | null; permanent: boolean; left: boolean };
export type LeaveLog = {
  from: string;
  to: string;
  entries: LeaveLogEntry[];
  people: LeaveLogPerson[];
  // The types in the filter: the register's three, then the Leave page's, in their order.
  types: { filter: string; label: string; name: string }[];
};

export const REGISTER_LEAVES: { filter: LeaveLogKind; label: string; name: string }[] = [
  { filter: "cl", label: "CL", name: "Casual leave" },
  { filter: "cl_half", label: "½ CL", name: "Half day casual leave" },
  { filter: "ch", label: "CH", name: "Compensation leave" },
];

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// One person's CL / CH days (in date order) as runs: the same mark on days one after another, or with only days off
// by themselves (`dayOff`: a holiday, their Sunday off) not marked between them, is one line. Half days are a line each.
export function markRuns(marks: { date: string; mark: "cl" | "cl_half" | "ch"; chHoliday: string | null }[], dayOff: (date: string) => boolean) {
  const marked = new Set(marks.map((m) => m.date));
  const runs: { mark: "cl" | "cl_half" | "ch"; from: string; to: string; days: string[]; holidays: (string | null)[] }[] = [];
  for (const m of marks) {
    const last = runs.at(-1);
    let joins = !!last && last.mark === m.mark && m.mark !== "cl_half";
    if (joins) {
      for (let d = nextDay(last!.to); d < m.date; d = nextDay(d))
        if (marked.has(d) || !dayOff(d)) {
          joins = false;
          break;
        }
    }
    if (joins) {
      last!.to = m.date;
      last!.days.push(m.date);
      last!.holidays.push(m.chHoliday);
    } else runs.push({ mark: m.mark, from: m.date, to: m.date, days: [m.date], holidays: [m.chHoliday] });
  }
  return runs;
}
