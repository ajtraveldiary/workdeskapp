// Leave of employees (user request 2026-10-30, plan in docs/LEAVE_PLAN.md): the longer leaves of permanent staff
// (earned leave, half pay leave, commuted leave…; not casual or compensation leave), and each employee's leave
// account. The account is a list of lines (opening balance, credits, leave taken, adjustments) that is never
// rewritten: a wrong line is put right with an adjustment.

export const LEDGER_KINDS = ["opening", "credit", "leave", "cancel", "adjust", "lapse", "surrender"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
// The lines a person adds by hand on the employee's page; the others come from marking leave and the credits.
export const HAND_KINDS = ["opening", "credit", "adjust"] as const satisfies readonly LedgerKind[];
export type HandKind = (typeof HAND_KINDS)[number];

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  opening: "Opening balance",
  credit: "Credit",
  leave: "Leave",
  cancel: "Days given back",
  adjust: "Adjustment",
  lapse: "Lapsed",
  surrender: "Surrendered",
};

// A leave type as "Add the usual leaves" makes it (Kerala Service Rules). drawsOn names another type by its short
// name: commuted leave and leave not due are taken from the half pay leave account. Every figure can be changed in
// Settings › Leave.
export type UsualLeaveType = {
  name: string;
  short: string;
  hasAccount: boolean;
  drawsOn?: string;
  perDay?: number;
  mayGoNegative?: boolean;
  maxBalance?: number;
  serviceLimit?: number;
  medical?: boolean;
  yearlyDays?: number;
  fromDuty?: boolean;
};
export const USUAL_LEAVE_TYPES: UsualLeaveType[] = [
  // 1/11 of the days on duty, credited on the service anniversary to staff whose probation is declared.
  { name: "Earned leave", short: "EL", hasAccount: true, maxBalance: 300, fromDuty: true },
  // 20 days for each completed year of service.
  { name: "Half pay leave", short: "HPL", hasAccount: true, yearlyDays: 20 },
  // Half pay leave taken at full pay on a medical certificate: each day takes 2 days of HPL.
  { name: "Commuted leave", short: "Commuted", hasAccount: false, drawsOn: "HPL", perDay: 2, medical: true },
  // Half pay leave not yet earned, on a medical certificate: HPL may go below zero; 360 days in the whole service.
  { name: "Leave not due", short: "LND", hasAccount: false, drawsOn: "HPL", mayGoNegative: true, serviceLimit: 360, medical: true },
  { name: "Extraordinary leave", short: "EOL", hasAccount: false },
  { name: "Maternity leave", short: "ML", hasAccount: false },
  { name: "Paternity leave", short: "PL", hasAccount: false },
];

// "20", "2.5", "-10".
export const formatDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const daysWord = (n: number) => `${formatDays(n)} ${Math.abs(n) === 1 ? "day" : "days"}`;
// The type's short name, else its name.
export const leaveShort = (t: { name: string; short: string }) => t.short || t.name;

// --- Marking a leave (phase 2) ---

// A leave's paperwork, as its task's steps (the user's lists, 2026-10-30). Fixed ids, so a step keeps its place.
export type LeaveStep = { id: string; text: string };
export const LEAVE_STEPS: { gazetted: LeaveStep[]; nonGazetted: LeaveStep[] } = {
  gazetted: [
    { id: "application", text: "Leave application received" },
    { id: "apply", text: "Apply leave" },
    { id: "leave-ctc", text: "Update leave CTC" },
    { id: "joining-report", text: "Joining report" },
    { id: "joining-ctc", text: "Joining CTC" },
    { id: "ag-payslip", text: "AG payslip" },
  ],
  nonGazetted: [
    { id: "application", text: "Application received" },
    { id: "check-account", text: "Check leave account" },
    { id: "proceedings", text: "Office proceedings" },
    { id: "spark", text: "Update in SPARK" },
    { id: "attendance", text: "Mark in attendance" },
    { id: "sb-update", text: "SB update" },
    { id: "joining-report", text: "Joining report" },
  ],
};
export const leaveSteps = (gazetted: boolean) => (gazetted ? LEAVE_STEPS.gazetted : LEAVE_STEPS.nonGazetted);

// Days from one date to another, both counted ("2026-11-01" to "2026-11-10" = 10).
export function calendarDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
export function shiftDate(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// The leave's last day: the day before rejoining when they came back early, else its "to" date.
export const leaveEnd = (l: { toDate: string; rejoinedOn: string | null }) => (l.rejoinedOn && shiftDate(l.rejoinedOn, -1) < l.toDate ? shiftDate(l.rejoinedOn, -1) : l.toDate);
// The day they are due back (the leave task is due then): the rejoining date, else the day after the leave.
export const rejoinDay = (l: { toDate: string; rejoinedOn: string | null }) => l.rejoinedOn ?? shiftDate(l.toDate, 1);
// "Leave: Priya Nair — HPL 10 days".
export const leaveTitle = (name: string, type: { name: string; short: string }, days: number) => `Leave: ${name} — ${leaveShort(type)} ${daysWord(days)}`;
