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

// The leave types built in from the Kerala Service Rules, Part I, Chapter IX (user request 2026-10-30: "leave types
// and their logic based on KSR must be hardcoded, with an option to edit them"). Every account has them (added by
// ensureKsrLeaveTypes, matched to an older type of the same name); each figure can be changed in Settings › Leave
// and put back with Reset to KSR; a type the office doesn't use is switched off, never removed. drawsOn names another
// KSR type: commuted leave and leave not due are taken from the half pay leave account. Limits are only warned about
// when crossed (user's choice), since government orders sometimes allow more.
export const KSR_KEYS = ["el", "hpl", "commuted", "lnd", "eol", "maternity", "miscarriage", "hysterectomy", "paternity", "adoption", "disability", "hospital"] as const;
export type KsrKey = (typeof KSR_KEYS)[number];
export type KsrLeaveType = {
  key: KsrKey;
  name: string;
  short: string;
  rule: string;
  // What the rule says, in a sentence (Settings › Leave, the type's form).
  about: string;
  hasAccount: boolean;
  drawsOn?: KsrKey;
  perDay?: number;
  mayGoNegative?: boolean;
  maxBalance?: number;
  serviceLimit?: number;
  medical?: boolean;
  yearlyDays?: number;
  fromDuty?: boolean;
  delaysIncrement?: boolean;
  atOnce?: number;
  nonMedicalAtOnce?: number;
  nonMedicalLimit?: number;
  spellLimit?: number;
  lastResort?: boolean;
  surrenderPerYear?: number;
  terminalSurrender?: number;
};
export const KSR_LEAVE_TYPES: KsrLeaveType[] = [
  {
    key: "el",
    name: "Earned leave",
    short: "EL",
    rule: "KSR Part I, Rules 78, 79",
    about:
      "1/11 of the days on duty, up to 300 days at credit; at most 180 days at a time (300 before retirement); EL and commuted leave together at most 240 days at a time (Rule 74); 30 days may be surrendered each financial year, and up to 300 days at retirement.",
    hasAccount: true,
    maxBalance: 300,
    fromDuty: true,
    atOnce: 180,
    spellLimit: 240,
    surrenderPerYear: 30,
    terminalSurrender: 300,
  },
  {
    key: "hpl",
    name: "Half pay leave",
    short: "HPL",
    rule: "KSR Part I, Rules 82, 83",
    about: "20 days for each completed year of service, with no upper limit; taken on private affairs or on a medical certificate.",
    hasAccount: true,
    yearlyDays: 20,
  },
  {
    key: "commuted",
    name: "Commuted leave",
    short: "Commuted",
    rule: "KSR Part I, Rules 84, 74",
    about: "On a medical certificate, at most half the half pay leave due: each day takes 2 days of HPL. EL and commuted leave together at most 240 days at a time.",
    hasAccount: false,
    drawsOn: "hpl",
    perDay: 2,
    medical: true,
    spellLimit: 240,
  },
  {
    key: "lnd",
    name: "Leave not due",
    short: "LND",
    rule: "KSR Part I, Rule 85",
    about:
      "Only to permanent staff when no other leave is at credit, taken from the half pay leave they will earn later; at most 360 days in the whole service, and without a medical certificate at most 90 days at a time and 180 days in all.",
    hasAccount: false,
    drawsOn: "hpl",
    mayGoNegative: true,
    serviceLimit: 360,
    nonMedicalAtOnce: 90,
    nonMedicalLimit: 180,
    lastResort: true,
  },
  {
    key: "eol",
    name: "Extraordinary leave",
    short: "EOL",
    rule: "KSR Part I, Rule 88",
    about: "Leave without allowance, when no other leave is admissible or when asked for in writing. Unless on a medical certificate it doesn't count for increment, pension or earned leave.",
    hasAccount: false,
    delaysIncrement: true,
  },
  {
    key: "maternity",
    name: "Maternity leave",
    short: "ML",
    rule: "KSR Part I, Rule 100",
    about: "Up to 180 days on full pay from the day it starts; not taken from the leave account.",
    hasAccount: false,
    atOnce: 180,
  },
  {
    key: "miscarriage",
    name: "Maternity leave (miscarriage / abortion)",
    short: "ML (miscarriage)",
    rule: "KSR Part I, Rule 101",
    about: "Up to 6 weeks for a miscarriage or abortion, on a medical certificate; not taken from the leave account.",
    hasAccount: false,
    medical: true,
    atOnce: 42,
  },
  {
    key: "hysterectomy",
    name: "Hysterectomy leave",
    short: "Hysterectomy",
    rule: "KSR Part I, Rule 101A",
    about: "Up to 45 days after a hysterectomy, on a medical certificate; not taken from the leave account.",
    hasAccount: false,
    medical: true,
    atOnce: 45,
  },
  {
    key: "paternity",
    name: "Paternity leave",
    short: "PL",
    rule: "KSR Part I, Rule 102B",
    about: "Up to 10 days for each of two deliveries of the wife (20 days in the whole service), before the birth or within 3 months after it; not taken from the leave account.",
    hasAccount: false,
    atOnce: 10,
    serviceLimit: 20,
  },
  {
    key: "adoption",
    name: "Child adoption leave",
    short: "Adoption",
    rule: "KSR Part I, Rule 102A",
    about: "Up to 180 days for a mother adopting a child under one year old (with fewer than two surviving children); not taken from the leave account.",
    hasAccount: false,
    atOnce: 180,
  },
  {
    key: "disability",
    name: "Special disability leave",
    short: "SDL",
    rule: "KSR Part I, Rules 97, 98",
    about: "For a disability caused in the course of duty, on a medical board's certificate: up to 24 months for any one disability; counts as duty for pension and isn't taken from the leave account.",
    hasAccount: false,
    medical: true,
    atOnce: 730,
  },
  {
    key: "hospital",
    name: "Hospital leave",
    short: "Hospital",
    rule: "KSR Part I, Rules 103 to 106",
    about: "For staff injured or ill because of their duties, while under medical treatment; not taken from the leave account and may be combined with any other leave.",
    hasAccount: false,
    medical: true,
  },
];
export const ksrType = (key: string | null | undefined) => KSR_LEAVE_TYPES.find((k) => k.key === key);

// The KSR limits a leave about to be marked crosses, as warnings naming the rule (it can still be saved). The
// balance and the whole-service limit are shown in the form separately.
export type LeaveLimitType = {
  name: string;
  short: string;
  rule: string;
  medical: boolean;
  atOnce: number | null;
  nonMedicalAtOnce: number | null;
  nonMedicalLimit: number | null;
  spellLimit: number | null;
  lastResort: boolean;
};
export function leaveWarnings(o: {
  type: LeaveLimitType;
  days: number;
  onMedical: boolean;
  // Days of this type already taken without a medical certificate (not this leave).
  usedNonMedical: number;
  // The unbroken run of leave this one joins, it included (spellDays), for a type with a spell limit.
  spell: number;
  // Other leave at credit, e.g. [{ short: "EL", balance: 12 }] (for "only when nothing else is left").
  atCredit: { short: string; balance: number }[];
}): string[] {
  const t = o.type;
  const s = leaveShort(t);
  const rule = t.rule ? ` (${t.rule})` : "";
  const out: string[] = [];
  if (t.medical && !o.onMedical) out.push(`${t.name} is given on a medical certificate${rule}.`);
  if (t.atOnce != null && o.days > t.atOnce) out.push(`At most ${daysWord(t.atOnce)} of ${s} at a time${rule}.`);
  if (!o.onMedical && t.nonMedicalAtOnce != null && o.days > t.nonMedicalAtOnce) out.push(`Without a medical certificate, at most ${daysWord(t.nonMedicalAtOnce)} of ${s} at a time${rule}.`);
  if (!o.onMedical && t.nonMedicalLimit != null && o.usedNonMedical + o.days > t.nonMedicalLimit)
    out.push(`Without a medical certificate, at most ${daysWord(t.nonMedicalLimit)} of ${s} in the whole service; this makes ${formatDays(o.usedNonMedical + o.days)}${rule}.`);
  if (t.spellLimit != null && o.spell > t.spellLimit) out.push(`This run of leave comes to ${daysWord(o.spell)}; at most ${daysWord(t.spellLimit)} at a time together${rule}.`);
  const left = o.atCredit.filter((c) => c.balance >= 0.5);
  if (t.lastResort && left.length) out.push(`${t.name} is given only when no other leave is at credit: ${left.map((c) => `${c.short} ${formatDays(c.balance)}`).join(", ")}${rule}.`);
  return out;
}

// The days of the unbroken run of leave from–to joins: its own days plus the active leaves of the given types that
// touch it, one after another (one starts the day after the other ends). exceptId: the leave being edited.
export function spellDays(
  leaves: { id: string; typeId: string; fromDate: string; toDate: string; rejoinedOn: string | null; days: number; status: string }[],
  from: string,
  to: string,
  days: number,
  typeIds: Set<string>,
  exceptId?: string | null,
) {
  const pool = leaves.filter((l) => l.status === "active" && l.id !== exceptId && typeIds.has(l.typeId));
  let start = from;
  let end = to;
  let total = days;
  const joined = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of pool) {
      if (joined.has(l.id)) continue;
      const lEnd = leaveEnd(l);
      if (shiftDate(lEnd, 1) === start || shiftDate(end, 1) === l.fromDate) {
        joined.add(l.id);
        total += l.days;
        if (l.fromDate < start) start = l.fromDate;
        if (lEnd > end) end = lEnd;
        grew = true;
      }
    }
  }
  return total;
}

// The financial year (April to March) a date falls in, as its first day: "2026-11-03" → "2026-04-01".
export function financialYearStart(day: string) {
  const y = Number(day.slice(0, 4));
  return `${day.slice(5) >= "04-01" ? y : y - 1}-04-01`;
}

// "20", "2.5", "-10".
export const formatDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const daysWord = (n: number) => `${formatDays(n)} ${Math.abs(n) === 1 ? "day" : "days"}`;
// The type's short name, else its name.
export const leaveShort = (t: { name: string; short: string }) => t.short || t.name;

// --- Marking a leave (phase 2) ---

// A leave's paperwork, as its task's steps (the user's lists, 2026-10-30). Fixed ids, so a step keeps its place.
// Gazetted (user request 2026-10-31): "Received relieving / joining CTC form" before the joining report, which is
// now "Update joining report in SPARK". Tasks made earlier keep the steps they were made with.
export type LeaveStep = { id: string; text: string };
export const LEAVE_STEPS: { gazetted: LeaveStep[]; nonGazetted: LeaveStep[] } = {
  gazetted: [
    { id: "application", text: "Leave application received" },
    { id: "apply", text: "Apply leave" },
    { id: "leave-ctc", text: "Update leave CTC" },
    { id: "ctc-form", text: "Received relieving / joining CTC form" },
    { id: "joining-report", text: "Update joining report in SPARK" },
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

// --- Automatic yearly credits (phase 3) ---

// The same date n years on (29 Feb → 28 Feb in a year without it).
export function addYears(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
// --- Surrender of earned leave (phase 4) ---

// Its paperwork (the plan's proposal, accepted 2026-10-30), as the surrender task's steps.
export const SURRENDER_STEPS: LeaveStep[] = [
  { id: "application", text: "Surrender application received" },
  { id: "sanction", text: "Sanction order" },
  { id: "bill", text: "Prepare bill" },
  { id: "spark", text: "Update in SPARK" },
  { id: "sb-update", text: "SB update" },
];
// "Leave surrender: Priya Nair — EL 30 days".
export const surrenderTitle = (name: string, type: { name: string; short: string }, days: number) => `Leave surrender: ${name} — ${leaveShort(type)} ${daysWord(days)}`;
// The whole days a leave moves an increment or probation date by (half a day counts as a day).
export const postponeDays = (days: number) => Math.ceil(days);

// Earned leave from duty: 1/11 of the days on duty, half a day or more rounding up.
export const earnedFromDuty = (dutyDays: number) => Math.round(Math.max(0, dutyDays) / 11);
