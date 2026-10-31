import { z } from "zod";
import { LABEL_COLORS } from "./labelColors";
import { MAX_TAGS_PER_ITEM, MAX_TAG_NAME, TAG_COLORS } from "./tags";
import { REPEATS } from "./reminderSchedule";
import { EMPLOYEE_CATEGORIES, ENGAGEMENTS, OFF_DAYS, RELATED_KINDS } from "./staff";
import { MOVE_KINDS, STEP_STATES } from "./moves";
import { HAND_KINDS } from "./leave";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
// The user's own Gmail labels only (system labels like INBOX are never accepted).
// A task's checklist: steps ticked one by one (user request 2026-10-07).
export const checklist = z
  .array(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1, "A step can't be empty").max(300), done: z.boolean(), waiting: z.boolean().optional(), at: z.string().max(40).optional() }))
  .max(50, "Up to 50 steps");
const userLabelIds = z.array(z.string().regex(/^Label_[\w-]+$/)).max(50);
export const priority = z.enum(["low", "normal", "high", "urgent"]);

const relatedKind = z.enum(RELATED_KINDS);

// Tags (user request 2026-10-11): WorkDesk tag ids on a task or reminder.
export const tagIds = z.array(z.uuid()).max(MAX_TAGS_PER_ITEM, `Up to ${MAX_TAGS_PER_ITEM} tags`);
export const tagInput = z.object({
  name: z.string().trim().min(1, "Tag name is required").max(MAX_TAG_NAME).transform((v) => v.replace(/\s+/g, " ")),
  // Left out (a tag made from a task or reminder form): the next colour round the palette.
  color: z.enum(TAG_COLORS).optional(),
});
export const tagPatch = z.object({ name: tagInput.shape.name, color: z.enum(TAG_COLORS) }).partial();

// Links kept with a reminder (user request 2026-10-07): web addresses only (Google Drive, Sheets, Docs…).
export const reminderLinks = z
  .array(
    z.object({
      url: z.string().trim().max(2000).regex(/^https?:\/\/[^\s]+\.[^\s]+$/i, "Paste a full link starting with https://"),
      name: z.string().trim().max(120).default(""),
    }),
  )
  .max(20, "Up to 20 links");

export const taskInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  notes: z.string().max(10_000).default(""),
  dueDate: day.nullable().default(null),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable().default(null),
  priority: priority.default("normal"),
  // Kept for tasks without an email; a task made from an email uses the email's labels.
  labelIds: userLabelIds.default([]),
  checklist: checklist.default([]),
  tagIds: tagIds.default([]),
  // Links kept with the task (user request 2026-10-19), like a reminder's: Google Sheets, portals, Drive files.
  links: reminderLinks.default([]),
  // Waiting for a reply, with the optional day a reply is expected by (user request 2026-10-07).
  waiting: z.boolean().default(false),
  replyBy: day.nullable().default(null),
  // What it is about (Staff, user request 2026-10-07): an employee, a designation or the general office.
  relatedKind: relatedKind.nullable().default(null),
  relatedId: z.uuid().nullable().default(null),
});
export type TaskInput = z.input<typeof taskInput>;

// Updates change only the fields they include. (taskInput.partial() would still apply taskInput's
// defaults, so a priority-only update used to wipe the due date, time, notes and labels.)
export const taskPatch = z
  .object({
    title: taskInput.shape.title,
    notes: z.string().max(10_000),
    dueDate: day.nullable(),
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable(),
    priority,
    labelIds: userLabelIds,
    checklist,
    tagIds,
    links: reminderLinks,
    waiting: z.boolean(),
    replyBy: day.nullable(),
    relatedKind: relatedKind.nullable(),
    relatedId: z.uuid().nullable(),
  })
  .partial();

export const bulkIds = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

// Reminders (stored as reports): the fields of a standard add-reminder screen.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const reportInput = z.object({
  name: z.string().trim().min(1, "Title is required").max(120),
  notes: z.string().max(5_000).default(""),
  repeat: z.enum(REPEATS).default("never"),
  startDate: day,
  dueTime: time.nullable().default(null),
  endDate: day.nullable().default(null),
  leadDays: z.number().int().min(0).max(90).default(0),
  priority: priority.default("normal"),
  active: z.boolean().default(true),
  links: reminderLinks.default([]),
  tagIds: tagIds.default([]),
  relatedKind: relatedKind.nullable().default(null),
  relatedId: z.uuid().nullable().default(null),
});
export type ReportInput = z.input<typeof reportInput>;

// Events (user request 2026-10-11): meetings, trainings, programmes. An end time needs a start time and comes
// after it. threadId: the email it is made from ("Make event"; only when adding).
const eventFields = {
  title: z.string().trim().min(1, "Title is required").max(300),
  typeId: z.uuid().nullable(),
  startDate: day,
  startTime: time.nullable(),
  endTime: time.nullable(),
  repeat: z.enum(REPEATS),
  endDate: day.nullable(),
  venue: z.string().trim().max(300),
  meetingUrl: z.union([z.literal(""), z.string().trim().max(2000).regex(/^https?:\/\/\S+$/i, "Paste a full link starting with https://")]),
  organiser: z.string().trim().max(200),
  attendeeIds: z.array(z.uuid()).max(300),
  notes: z.string().max(10_000),
  links: reminderLinks,
  prepDays: z.number().int().min(0).max(60).nullable(),
};
const timesInOrder = (v: { startTime?: string | null; endTime?: string | null }) => !v.endTime || (!!v.startTime && v.endTime > v.startTime);
export const eventInput = z
  .object({
    ...eventFields,
    typeId: eventFields.typeId.default(null),
    startTime: eventFields.startTime.default(null),
    endTime: eventFields.endTime.default(null),
    repeat: eventFields.repeat.default("never"),
    endDate: eventFields.endDate.default(null),
    venue: eventFields.venue.default(""),
    meetingUrl: eventFields.meetingUrl.default(""),
    organiser: eventFields.organiser.default(""),
    attendeeIds: eventFields.attendeeIds.default([]),
    notes: eventFields.notes.default(""),
    links: eventFields.links.default([]),
    prepDays: eventFields.prepDays.default(null),
    threadId: z.uuid().nullable().default(null),
  })
  .refine(timesInOrder, { message: "The end time must be after the start time", path: ["endTime"] });
export type EventInput = z.input<typeof eventInput>;
// Updates change only the fields they include.
export const eventPatch = z.object(eventFields).partial();
// One occurrence (by its scheduled day): done, cancelled, moved to another day/time, or back to scheduled.
export const occurrenceInput = z
  .object({
    date: day,
    // "scheduled" undoes done / cancelled (a move stays); "original" also undoes a move.
    status: z.enum(["scheduled", "done", "cancelled", "moved", "original"]),
    newDate: day.optional(),
    newTime: time.nullable().optional(),
    newEndTime: time.nullable().optional(),
  })
  .refine((v) => v.status !== "moved" || !!v.newDate, { message: "Choose the new date", path: ["newDate"] });
// Updates change only the fields they include (reportInput.partial() would apply reportInput's defaults,
// so pausing a reminder would reset its settings).
export const reportPatch = z
  .object({
    name: reportInput.shape.name,
    notes: z.string().max(5_000),
    repeat: z.enum(REPEATS),
    startDate: day,
    dueTime: time.nullable(),
    endDate: day.nullable(),
    leadDays: z.number().int().min(0).max(90),
    priority,
    active: z.boolean(),
    links: reminderLinks,
    tagIds,
    relatedKind: relatedKind.nullable(),
    relatedId: z.uuid().nullable(),
  })
  .partial();

// "Hide from Pending" entries: an exact address, or "@domain" for a whole domain. Accepts pasted forms
// like "Name <a@b.gov>", "mailto:a@b.gov" or a bare "b.gov". Returns null when it isn't either.
export function normalizeSenderPattern(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  const angle = v.match(/<([^>]+)>/);
  if (angle) v = angle[1]!.trim();
  v = v.replace(/^mailto:/, "");
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) return v;
  const domain = v.startsWith("@") ? v : v.includes("@") ? null : `@${v}`;
  return domain && /^@[^\s@<>]+\.[^\s@<>]+$/.test(domain) ? domain : null;
}

export const snippetInput = z.object({ text: z.string().trim().min(3, "Too short to hide safely").max(2000) });

export const mutedSenderInput = z.object({
  pattern: z
    .string()
    .max(254)
    .transform((v, ctx) => {
      const p = normalizeSenderPattern(v);
      if (!p) ctx.addIssue({ code: "custom", message: "Enter an email address, or @domain for a whole domain" });
      return p ?? "";
    }),
});

// Gmail labels. Colours must come from LABEL_COLORS (Gmail only accepts its own palette).
const labelColor = z
  .object({ backgroundColor: z.string(), textColor: z.string() })
  .refine((c) => LABEL_COLORS.some((p) => p.backgroundColor === c.backgroundColor && p.textColor === c.textColor), "Pick one of the offered colours")
  .nullable();
export const labelInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(225),
  color: labelColor.default(null),
});
// Only the fields sent change (labelInput.partial() would turn a missing colour into "no colour").
export const labelPatch = z.object({ name: labelInput.shape.name, color: labelColor }).partial();
// Remove → "Send to a section" (user request 2026-10-07): put a section's label on the emails (Gmail too) and
// move them to Other sections; undo takes it off again. Up to 40 at once (one Gmail call each).
export const sendToSectionInput = z.object({
  ids: z.array(z.uuid()).min(1).max(40, "Choose up to 40 emails at a time"),
  labelId: z.string().regex(/^Label_[\w-]+$/),
  undo: z.boolean().default(false),
  // With undo: how each email was before, so it goes back exactly there (Pending, or Pending "Back from" a
  // section, or another section).
  previous: z
    .array(z.object({ id: z.uuid(), state: z.enum(["needs_decision", "elsewhere"]), sectionLabelId: z.string().regex(/^Label_[\w-]+$/).nullable() }))
    .max(40)
    .default([]),
});

export const threadLabelsInput = z.object({
  add: z.array(z.string().regex(/^Label_[\w-]+$/)).max(50).default([]),
  remove: z.array(z.string().regex(/^Label_[\w-]+$/)).max(50).default([]),
});

export const taskLabelSettingsInput = z.object({
  taskLabelId: z.string().regex(/^Label_[\w-]+$/).nullable(),
  doneLabelId: z.string().regex(/^Label_[\w-]+$/).nullable(),
  // No longer used (replaced by organizeLabelIds, user request 2026-10-07); accepted and ignored.
  autoDoneLabelIds: z.array(z.string().regex(/^Label_[\w-]+$/)).max(50).optional(),
  // Labels only for organising mail, not sections of the office (left out = unchanged).
  organizeLabelIds: z.array(z.string().regex(/^Label_[\w-]+$/)).max(100).optional(),
});

// Phone notifications (user request 2026-10-07).
export const pushSubscribeInput = z.object({
  endpoint: z.url().max(1000).regex(/^https:\/\//, "Push services use https"),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  device: z.string().max(120).optional(),
});
export const pushSettingsInput = z.object({
  summaryOn: z.boolean(),
  summaryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  dueOn: z.boolean(),
});

// Staff page (user request 2026-10-07). Every detail but the name is optional.
export const designationInput = z.object({ name: z.string().trim().min(1, "Name is required").max(80) });
// A list arranged by drag and drop (user request 2026-10-08): its ids in the new order.
export const orderInput = z.object({ ids: z.array(z.uuid()).min(1).max(500) });
// Joining and relieving (user request 2026-10-15).
// doneSteps: steps already done when someone already working here is put into the joining process (user request
// 2026-10-16, Settings › Employees).
export const moveInput = z.object({ employeeId: z.uuid(), kind: z.enum(MOVE_KINDS), date: day, doneSteps: z.array(z.string().min(1).max(40)).max(10).default([]) });
export const moveStepInput = z.object({ step: z.string().min(1).max(40), state: z.enum(STEP_STATES) });
// Registers (user request 2026-10-16). An entry's dueDate makes (or moves) its task; null takes the task away.
export const registerPatch = z.object({ name: z.string().trim().min(1, "Name is required").max(80).optional(), updatedUntil: day.nullable().optional() });
const entryFields = {
  registerId: z.uuid(),
  text: z.string().trim().min(1, "Write what needs updating").max(500),
  employeeId: z.uuid().nullable(),
  dueDate: day.nullable(),
};
export const entryInput = z.object({ ...entryFields, employeeId: entryFields.employeeId.default(null), dueDate: entryFields.dueDate.default(null) });
export const entryPatch = z.object(entryFields).partial();
export type EntryInput = z.input<typeof entryInput>;
// Which employee the user is (user request 2026-10-12).
export const meEmployeeInput = z.object({ employeeId: z.uuid().nullable() });
export const employeeInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  designationId: z.uuid().nullable().default(null),
  permanent: z.boolean().default(true),
  engagedTill: day.nullable().default(null),
  engagement: z.union([z.literal(""), z.enum(ENGAGEMENTS)]).default(""),
  typeId: z.uuid().nullable().default(null),
  contractDays: z.number().int().min(1, "At least 1 day").max(3650).nullable().default(null),
  payPerDay: z.number().min(0).max(1_000_000).nullable().default(null),
  pen: z.string().trim().max(20).default(""),
  phone: z.string().trim().max(20).regex(/^[0-9+\-\s()]*$/, "Use digits only").default(""),
  email: z.union([z.literal(""), z.email("Check the email address")]).default(""),
  dateOfBirth: day.nullable().default(null),
  category: z.union([z.literal(""), z.enum(EMPLOYEE_CATEGORIES)]).default(""),
  joinedServiceOn: day.nullable().default(null),
  joinedOfficeOn: day.nullable().default(null),
  nextIncrementOn: day.nullable().default(null),
  retiresOn: day.nullable().default(null),
  payScale: z.string().trim().max(100).default(""),
  // Basic pay in ₹ (user request 2026-10-08). Optional so an older form that doesn't send it leaves it alone.
  basicPay: z.number().min(0).max(10_000_000).nullable().optional(),
  probationDeclaredOn: day.nullable().default(null),
  // Yes / no (user request 2026-10-30). Optional: left out keeps the saved value (a new employee: no, or the
  // designation's gazetted tick); a declared date always means yes.
  probationDeclared: z.boolean().optional(),
  gazetted: z.boolean().optional(),
  // Sunday off / weekly off (user request 2026-10-31). Optional like the switches: left out keeps the saved value
  // (a new employee: Sunday off).
  offDay: z.enum(OFF_DAYS).optional(),
  address: z.string().trim().max(500).default(""),
  notes: z.string().max(5_000).default(""),
});
export type EmployeeInput = z.input<typeof employeeInput>;

// Leave (user request 2026-10-30, docs/LEAVE_PLAN.md).
const leaveDays = (max: number) => z.number().min(0).max(max).multipleOf(0.5, "Use whole or half days");
export const leaveTypeInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  short: z.string().trim().max(12).default(""),
  hasAccount: z.boolean().default(true),
  drawsOnId: z.uuid().nullable().default(null),
  perDay: z.number().min(0.5).max(5).multipleOf(0.5).default(1),
  mayGoNegative: z.boolean().default(false),
  maxBalance: leaveDays(9999).nullable().default(null),
  serviceLimit: leaveDays(9999).nullable().default(null),
  medical: z.boolean().default(false),
  yearlyDays: leaveDays(365).nullable().default(null),
  fromDuty: z.boolean().default(false),
  // Credit it automatically on each service anniversary (phase 3), from the day this is switched on.
  autoCredit: z.boolean().default(false),
  // Doesn't count for increment or probation (EOL, phase 4).
  delaysIncrement: z.boolean().default(false),
  // The KSR rule it follows and its limits (each only warned about), and whether it is offered in Mark leave.
  rule: z.string().trim().max(120).default(""),
  active: z.boolean().default(true),
  atOnce: leaveDays(9999).nullable().default(null),
  nonMedicalAtOnce: leaveDays(9999).nullable().default(null),
  nonMedicalLimit: leaveDays(9999).nullable().default(null),
  spellLimit: leaveDays(9999).nullable().default(null),
  lastResort: z.boolean().default(false),
  surrenderPerYear: leaveDays(9999).nullable().default(null),
  terminalSurrender: leaveDays(9999).nullable().default(null),
});
export type LeaveTypeInput = z.input<typeof leaveTypeInput>;
// A line added by hand on the employee's page: opening balance (from the service book), a credit or an adjustment
// (+ or −).
export const leaveLineInput = z
  .object({
    typeId: z.uuid(),
    kind: z.enum(HAND_KINDS),
    onDate: day,
    days: z.number().min(-9999).max(9999).multipleOf(0.5, "Use whole or half days"),
    note: z.string().trim().max(300).default(""),
  })
  .refine((v) => v.kind === "opening" || v.days !== 0, { message: "Enter the number of days", path: ["days"] })
  .refine((v) => v.kind !== "credit" || v.days > 0, { message: "A credit adds days; use an adjustment to take days away", path: ["days"] });
export type LeaveLineInput = z.input<typeof leaveLineInput>;
// Marking a leave (phase 2). days: calendar days from–to unless edited (holidays left out), half days allowed.
const leaveFields = {
  typeId: z.uuid(),
  fromDate: day,
  toDate: day,
  days: z.number().min(0.5, "At least half a day").max(9999).multipleOf(0.5, "Use whole or half days"),
  orderNo: z.string().trim().max(100).default(""),
  orderDate: day.nullable().default(null),
  notes: z.string().max(2_000).default(""),
  // On a medical certificate (commuted leave needs one; LND without one has lower limits; EOL with one counts for
  // increment).
  onMedical: z.boolean().default(false),
};
const datesInOrder = (v: { fromDate: string; toDate: string }) => v.toDate >= v.fromDate;
export const leaveInput = z
  .object({
    employeeId: z.uuid(),
    ...leaveFields,
    doneSteps: z.array(z.string().max(40)).max(20).default([]),
    extensionOfId: z.uuid().nullable().default(null),
    // A type that doesn't count for increment / probation (EOL, phase 4): move those dates by its days.
    postpone: z.object({ increment: z.boolean().default(false), probation: z.boolean().default(false) }).default({ increment: false, probation: false }),
  })
  .refine(datesInOrder, { message: "The leave ends before it starts", path: ["toDate"] });
export type LeaveInput = z.input<typeof leaveInput>;
// Editing: every field again, and the rejoining date once the joining report is in.
export const leavePatch = z
  .object({ ...leaveFields, rejoinedOn: day.nullable().default(null) })
  .refine(datesInOrder, { message: "The leave ends before it starts", path: ["toDate"] })
  .refine((v) => !v.rejoinedOn || v.rejoinedOn > v.fromDate, { message: "Rejoined before the leave started", path: ["rejoinedOn"] });
export type LeavePatch = z.input<typeof leavePatch>;
// Undo of the dates a leave moved: each goes back only if it is still the moved date.
const moved = z.object({ from: day, to: day });
export const postponeUndoInput = z.object({ increment: moved.optional(), probation: moved.extend({ taskId: z.uuid() }).optional() });
// Surrender of earned leave (phase 4): the days come off the balance and a task with the surrender steps is made.
export const leaveSurrenderInput = z.object({
  typeId: z.uuid(),
  days: z.number().min(0.5).max(365).multipleOf(0.5, "Use whole or half days"),
  onDate: day,
  orderNo: z.string().trim().max(100).default(""),
  note: z.string().trim().max(300).default(""),
  doneSteps: z.array(z.string().max(40)).max(20).default([]),
  // At retirement (terminal surrender): not counted in the financial year's limit.
  terminal: z.boolean().default(false),
});
export type LeaveSurrenderInput = z.input<typeof leaveSurrenderInput>;
// "Credit now" for every permanent employee still in the office: creditFor is the year it counts for.
export const leaveCreditInput = z.object({
  creditFor: z.string().regex(/^\d{4}$/, "Give the year, e.g. 2027"),
  onDate: day,
  days: z.number().min(0.5).max(365).multipleOf(0.5, "Use whole or half days"),
  note: z.string().trim().max(300).default(""),
  dryRun: z.boolean().default(false),
});

// File register (user request 2026-10-07).
export const officeFileInput = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  physical: z.boolean().default(true),
  efileNumber: z.string().trim().max(50).default(""),
  notes: z.string().max(2_000).default(""),
  // Tags (user request 2026-10-11), shared with tasks and reminders.
  tagIds: tagIds.default([]),
});
export type OfficeFileInput = z.input<typeof officeFileInput>;

// Saved website logins (user request 2026-10-11). assignedTo is a role or name typed in (DDO, Section clerk);
// with an employee picked it is ignored (their name is used). password: left out = unchanged, "" or null = removed.
export const siteLoginInput = z.object({
  website: z.string().trim().min(1, "Website name is required").max(100),
  url: z
    .string()
    .trim()
    .max(500)
    .default("")
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v)),
  employeeId: z.uuid().nullable().default(null),
  assignedTo: z.string().trim().max(100).default(""),
  loginId: z.string().trim().max(200).default(""),
  password: z.string().max(500).nullable().optional(),
  remarks: z.string().trim().max(2000).default(""),
});
export type SiteLoginInput = z.input<typeof siteLoginInput>;

// Settings › Assistant (MCP Phase 3, user request 2026-10-18): may assistants change things, and how many changes an hour.
export const ASSISTANT_PER_HOUR = [10, 30, 60, 100] as const;
// allowStaff (Phase 4): staff actions too; left out = off.
export const assistantSettingsInput = z.object({ allowChanges: z.boolean(), perHour: z.number().int().min(1).max(100), allowStaff: z.boolean().default(false) });

// Office details (user request 2026-10-19): what an official letter needs, so assistants leave [blanks] only for
// what is really unknown. Every field is optional; lists are short.
const line = (max: number) => z.string().trim().max(max).default("");
export const officeProfileInput = z.object({
  officeName: line(200),
  address: line(600),
  phone: line(60),
  email: z.union([z.literal(""), z.email("Check the email address")]).default(""),
  seat: line(120),
  signature: line(600),
  fileNumberPattern: line(120),
  recipients: z
    .array(z.object({ who: z.string().trim().min(1, "Say who the recipient is").max(200), address: line(600) }))
    .max(30, "Up to 30 recipients")
    .default([]),
  codes: z
    .array(z.object({ label: z.string().trim().min(1, "Give the code a name").max(60), value: z.string().trim().min(1, "Enter the code").max(120) }))
    .max(30, "Up to 30 codes")
    .default([]),
  letterLanguage: z.enum(["English", "Malayalam"]).default("English"),
});
export type OfficeProfile = z.output<typeof officeProfileInput>;
export type OfficeProfileInput = z.input<typeof officeProfileInput>;

