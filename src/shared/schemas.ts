import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const priority = z.enum(["low", "normal", "high", "urgent"]);

export const taskInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  notes: z.string().max(10_000).default(""),
  dueDate: day.nullable().default(null),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable().default(null),
  priority: priority.default("normal"),
  categoryId: z.uuid().nullable().default(null),
});
export type TaskInput = z.input<typeof taskInput>;

export const taskPatch = taskInput.partial();

export const snoozeInput = z.object({ until: z.iso.datetime({ offset: true }) });
export const threadPatch = z.object({ categoryId: z.uuid().nullable() });
export const bulkIds = z.object({ ids: z.array(z.uuid()).min(1).max(500) });
export const categoryInput = z.object({ name: z.string().trim().min(1).max(60) });

export const reportInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  notes: z.string().max(5_000).default(""),
  frequency: z.enum(["monthly", "quarterly", "half_yearly", "annual"]),
  dueDay: z.number().int().min(1).max(31),
  dueMonthOffset: z.number().int().min(0).max(12),
  yearStartMonth: z.number().int().min(1).max(12).default(4),
  leadDays: z.number().int().min(0).max(90).default(7),
  priority: priority.default("high"),
  categoryId: z.uuid().nullable().default(null),
  responsible: z.string().trim().max(80).nullable().default(null),
  firstPeriodStart: day,
  active: z.boolean().default(true),
});
export type ReportInput = z.input<typeof reportInput>;
export const reportPatch = reportInput.partial();

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
