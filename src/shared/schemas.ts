import { z } from "zod";
import { LABEL_COLORS } from "./labelColors";
import { REPEATS } from "./reminderSchedule";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
// The user's own Gmail labels only (system labels like INBOX are never accepted).
const userLabelIds = z.array(z.string().regex(/^Label_[\w-]+$/)).max(50);
export const priority = z.enum(["low", "normal", "high", "urgent"]);

export const taskInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  notes: z.string().max(10_000).default(""),
  dueDate: day.nullable().default(null),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable().default(null),
  priority: priority.default("normal"),
  // Kept for tasks without an email; a task made from an email uses the email's labels.
  labelIds: userLabelIds.default([]),
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
export const threadLabelsInput = z.object({
  add: z.array(z.string().regex(/^Label_[\w-]+$/)).max(50).default([]),
  remove: z.array(z.string().regex(/^Label_[\w-]+$/)).max(50).default([]),
});

export const taskLabelSettingsInput = z.object({
  taskLabelId: z.string().regex(/^Label_[\w-]+$/).nullable(),
  doneLabelId: z.string().regex(/^Label_[\w-]+$/).nullable(),
  // Labels whose emails go straight to completed tasks (left out = unchanged).
  autoDoneLabelIds: z.array(z.string().regex(/^Label_[\w-]+$/)).max(50).optional(),
});
