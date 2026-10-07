import { z } from "zod";
import { LABEL_COLORS } from "./labelColors";
import { REPEATS } from "./reminderSchedule";
import { EMPLOYEE_CATEGORIES, RELATED_KINDS } from "./staff";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
// The user's own Gmail labels only (system labels like INBOX are never accepted).
// A task's checklist: steps ticked one by one (user request 2026-10-07).
export const checklist = z
  .array(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1, "A step can't be empty").max(300), done: z.boolean() }))
  .max(50, "Up to 50 steps");
const userLabelIds = z.array(z.string().regex(/^Label_[\w-]+$/)).max(50);
export const priority = z.enum(["low", "normal", "high", "urgent"]);

const relatedKind = z.enum(RELATED_KINDS);

export const taskInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  notes: z.string().max(10_000).default(""),
  dueDate: day.nullable().default(null),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable().default(null),
  priority: priority.default("normal"),
  // Kept for tasks without an email; a task made from an email uses the email's labels.
  labelIds: userLabelIds.default([]),
  checklist: checklist.default([]),
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
    waiting: z.boolean(),
    replyBy: day.nullable(),
    relatedKind: relatedKind.nullable(),
    relatedId: z.uuid().nullable(),
  })
  .partial();

export const bulkIds = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

// Reminders (stored as reports): the fields of a standard add-reminder screen.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
// Links kept with a reminder (user request 2026-10-07): web addresses only (Google Drive, Sheets, Docs…).
export const reminderLinks = z
  .array(
    z.object({
      url: z.string().trim().max(2000).regex(/^https?:\/\/[^\s]+\.[^\s]+$/i, "Paste a full link starting with https://"),
      name: z.string().trim().max(120).default(""),
    }),
  )
  .max(20, "Up to 20 links");

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
  relatedKind: relatedKind.nullable().default(null),
  relatedId: z.uuid().nullable().default(null),
});
export type ReportInput = z.input<typeof reportInput>;
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
export const employeeInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  designationId: z.uuid().nullable().default(null),
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
  probationDeclaredOn: day.nullable().default(null),
  address: z.string().trim().max(500).default(""),
  notes: z.string().max(5_000).default(""),
});
export type EmployeeInput = z.input<typeof employeeInput>;
