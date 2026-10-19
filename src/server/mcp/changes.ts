// The assistant's change tools (MCP Phase 3, user request 2026-10-18; docs/MCP_PLAN.md): everyday changes made
// exactly as the app makes them, through its own routes (ctx.send), so every rule, History entry and Gmail label
// change is the same. They only work while Allow changes is on in Settings › Assistant, count towards the hourly
// limit, touch at most 10 items per call, and never delete anything (server.ts checks the switch and the limit,
// marks the History entries "via <assistant>" and writes the assistant log with what was touched).
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { tasks } from "../db/schema";
import { selectTasks, toTask } from "../routes/tasks";
import { REPEATS } from "../../shared/reminderSchedule";
import type { ChecklistItem, EventType, Label, OfficeEvent, OfficeFile, Register, RegisterEntry, Report, Tag, Task, Thread } from "../../shared/types";
import { Lookups, clean, taskOut, type Names, type Tool, type ToolCtx, type Touched } from "./tools";

const MAX_ITEMS = 10;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 hours)");
const PRIORITY_IN = { urgent: "urgent", high: "high", medium: "normal", low: "low" } as const;
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const stepId = () => crypto.randomUUID().slice(0, 12);
const ids = (what: string) => z.array(z.string().uuid()).min(1).max(MAX_ITEMS, `At most ${MAX_ITEMS} ${what} at a time`);

// A name the assistant gave that doesn't match exactly one thing: the tool answers with the choices.
class Unclear extends Error {}

// "For": an employee (by name), a designation ("All Staff Nurse" or the designation's name), or the general office.
function resolveFor(n: Names, text: string): { relatedKind: "employee" | "designation" | "office" | null; relatedId: string | null } {
  const q = lower(text).replace(/^all\s+/, "").replace(/\s*\(all\)$/, "");
  if (!q || ["nobody", "none", "no one"].includes(q)) return { relatedKind: null, relatedId: null };
  if (["general office", "office", "general"].includes(q)) return { relatedKind: "office", relatedId: null };
  const people = [...n.employee.values()].filter((e) => !e.leftOn);
  const exact = people.filter((e) => lower(e.name) === q);
  const desig = [...n.designation.entries()].filter(([, name]) => lower(name) === q);
  if (exact.length === 1) return { relatedKind: "employee", relatedId: exact[0]!.id };
  if (desig.length === 1 && !exact.length) return { relatedKind: "designation", relatedId: desig[0]![0] };
  const some = people.filter((e) => lower(e.name).includes(q));
  if (some.length === 1 && !exact.length) return { relatedKind: "employee", relatedId: some[0]!.id };
  const choices = [...(exact.length ? exact : some).map((e) => e.name), ...desig.map(([, d]) => `All ${d}`)];
  throw new Unclear(choices.length ? `"${text}" could be: ${choices.join(", ")}. Say which.` : `No employee or designation called "${text}". Use "General office" for the whole office.`);
}

function resolveEmployee(n: Names, text: string): string | null {
  const q = lower(text);
  if (!q || ["general", "nobody", "none"].includes(q)) return null;
  const people = [...n.employee.values()].filter((e) => !e.leftOn);
  const exact = people.filter((e) => lower(e.name) === q);
  const found = exact.length ? exact : people.filter((e) => lower(e.name).includes(q));
  if (found.length === 1) return found[0]!.id;
  throw new Unclear(found.length ? `"${text}" could be: ${found.map((e) => e.name).join(", ")}. Say which.` : `No employee in the office called "${text}".`);
}

// Tags by name; a name that isn't a tag yet becomes one (as typing a new tag in the task form does).
async function resolveTags(ctx: ToolCtx, names: string[]): Promise<string[]> {
  const { tags } = await ctx.api<{ tags: Tag[] }>("/tags");
  const out: string[] = [];
  for (const name of names) {
    const t = tags.find((x) => lower(x.name) === lower(name));
    out.push(t ? t.id : (await ctx.send<{ id: string }>("POST", "/tags", { name })).id);
  }
  return [...new Set(out)];
}

async function loadTask(ctx: ToolCtx, id: string): Promise<Task> {
  const [row] = await selectTasks(ctx.db).where(and(eq(tasks.userId, ctx.userId), eq(tasks.id, id)));
  if (!row) throw new Unclear(`No task with id ${id}`);
  return toTask(row);
}

const taskFields = {
  dueDate: day.nullable().optional().describe("Due date (YYYY-MM-DD); null takes it away"),
  dueTime: time.nullable().optional().describe("Due time (HH:MM, 24 hours); null takes it away"),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  notes: z.string().max(10_000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().describe("Tag names; new names become tags"),
  for: z.string().max(200).optional().describe('Who it is for: an employee\'s name, a designation ("All Staff Nurse"), "General office", or "nobody"'),
  waitingForReply: z.boolean().optional().describe("Waiting for someone's reply"),
  replyBy: day.nullable().optional().describe("The day a reply is expected"),
};

// The parts of a task form the assistant gave, in the app's own shape.
async function taskBody(ctx: ToolCtx, n: Names, a: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  if (a.dueDate !== undefined) body.dueDate = a.dueDate;
  if (a.dueTime !== undefined) body.dueTime = a.dueTime;
  if (a.priority) body.priority = PRIORITY_IN[a.priority as keyof typeof PRIORITY_IN];
  if (a.notes !== undefined) body.notes = a.notes;
  if (a.tags) body.tagIds = await resolveTags(ctx, a.tags as string[]);
  if (a.for !== undefined) Object.assign(body, resolveFor(n, String(a.for)));
  if (a.waitingForReply !== undefined) body.waiting = a.waitingForReply;
  if (a.replyBy !== undefined) body.replyBy = a.replyBy;
  return body;
}

const taskTouched = (t: { id: string; title: string }): Touched => ({ kind: "task", id: t.id, title: t.title });
// The task as it is now (names loaded afresh: the change may have made a new tag).
async function done(ctx: ToolCtx, id: string, note: string) {
  const [t, n] = await Promise.all([loadTask(ctx, id), new Lookups(ctx).names()]);
  return { data: clean({ done: note, task: taskOut(t, n, ctx.today, true) }), touched: [taskTouched(t)] };
}

// Run a change; a name that didn't resolve comes back as a plain answer the assistant can act on.
const safely =
  (run: Tool["run"]): Tool["run"] =>
  async (ctx, a) => {
    try {
      return await run(ctx, a);
    } catch (e) {
      if (e instanceof Unclear) return { data: { error: e.message } };
      throw e;
    }
  };

const ASK = " Before calling, tell the user exactly what will change and wait for their yes.";


// A reminder or file register entry by id or name (part of it is enough when only one fits).
function pick<T extends { id: string }>(items: T[], text: string, name: (x: T) => string, what: string): T {
  const q = lower(text);
  const byId = items.find((x) => x.id === text);
  if (byId) return byId;
  const exact = items.filter((x) => lower(name(x)) === q);
  const found = exact.length ? exact : items.filter((x) => lower(name(x)).includes(q));
  if (found.length === 1) return found[0]!;
  throw new Unclear(found.length ? `"${text}" could be: ${found.slice(0, 10).map(name).join("; ")}. Say which.` : `No ${what} called "${text}".`);
}

const reminderFields = {
  date: day.optional().describe("The first date (YYYY-MM-DD)"),
  time: time.nullable().optional(),
  repeat: z.enum(REPEATS).optional().describe("never, daily, weekly, biweekly, monthly, quarterly, half_yearly or yearly"),
  repeatUntil: day.nullable().optional().describe("No dates after this day"),
  remindDaysBefore: z.number().int().min(0).max(90).optional().describe("Its task shows this many days before each date"),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  notes: z.string().max(5_000).optional(),
  links: z.array(z.object({ url: z.string().max(2000), name: z.string().max(120).optional() })).max(20).optional().describe("Links such as the Google Sheet to fill (replace the list)"),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  for: z.string().max(200).optional().describe('An employee, a designation ("All Staff Nurse"), "General office", or "nobody"'),
};

async function reminderBody(ctx: ToolCtx, n: Names, a: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  if (a.name) body.name = a.name;
  if (a.date) body.startDate = a.date;
  if (a.time !== undefined) body.dueTime = a.time;
  if (a.repeat) body.repeat = a.repeat;
  if (a.repeatUntil !== undefined) body.endDate = a.repeatUntil;
  if (a.remindDaysBefore !== undefined) body.leadDays = a.remindDaysBefore;
  if (a.priority) body.priority = PRIORITY_IN[a.priority as keyof typeof PRIORITY_IN];
  if (a.notes !== undefined) body.notes = a.notes;
  if (a.links) body.links = (a.links as { url: string; name?: string }[]).map((l) => ({ url: /^https?:\/\//i.test(l.url.trim()) ? l.url.trim() : `https://${l.url.trim()}`, name: l.name ?? "" }));
  if (a.tags) body.tagIds = await resolveTags(ctx, a.tags as string[]);
  if (a.for !== undefined) Object.assign(body, resolveFor(n, String(a.for)));
  return body;
}
const reminderTouched = (r: { id: string; name: string }): Touched => ({ kind: "reminder", id: r.id, title: r.name });
const fileTouched = (f: { id: string; subject: string }): Touched => ({ kind: "file", id: f.id, title: f.subject });

export const CHANGE_TOOLS: Tool[] = [
  {
    name: "create_task",
    title: "Create a task",
    write: true,
    description: "Add a task to the user's to-do list, as New task in the app: title (Malayalam or English), due date and time, priority, notes, steps, tags, who it is for, waiting for a reply." + ASK,
    input: z.object({ title: z.string().trim().min(1).max(300), steps: z.array(z.string().trim().min(1).max(300)).max(50).optional().describe("Checklist steps, in order"), ...taskFields }),
    run: safely(async (ctx, a) => {
      const n = await new Lookups(ctx).names();
      const body = { title: a.title, ...(await taskBody(ctx, n, a)), checklist: ((a.steps as string[]) ?? []).map((text) => ({ id: stepId(), text, done: false })) };
      const t = await ctx.send<{ id: string; title: string }>("POST", "/tasks", body);
      return done(ctx, t.id, "Task created");
    }),
  },

  {
    name: "make_task_from_email",
    title: "Make a task from an email",
    write: true,
    description: "Create a task from a Pending email (or one in Other sections), as Create task in the app: the email leaves Pending and gets the task label in Gmail. For an email that already has a task, use add_emails_to instead." + ASK,
    input: z.object({ emailId: z.string().uuid(), title: z.string().trim().min(1).max(300), steps: z.array(z.string().trim().min(1).max(300)).max(50).optional(), ...taskFields }),
    run: safely(async (ctx, a) => {
      const n = await new Lookups(ctx).names();
      const email = await ctx.api<Thread>(`/threads/${a.emailId}`);
      if (email.state !== "needs_decision" && email.state !== "elsewhere") return { data: { error: `This email isn't waiting for a decision (it is: ${email.state === "task" ? "already a task" : email.state}). Use add_emails_to to add it to a task.` } };
      const body = { title: a.title, notes: email.subject, ...(await taskBody(ctx, n, a)), checklist: ((a.steps as string[]) ?? []).map((text) => ({ id: stepId(), text, done: false })) };
      const t = await ctx.send<{ id: string; title: string }>("POST", `/threads/${a.emailId}/task`, body);
      const out = await done(ctx, t.id, "Task created from the email; the email left Pending");
      return { ...out, touched: [...out.touched, { kind: "email", id: email.id, title: email.subject }] };
    }),
  },

  {
    name: "update_task",
    title: "Change a task",
    write: true,
    description:
      "Change a task: title, due date / time, priority, notes (replace, or add to the end), steps (add new ones; tick or untick by their number from get_task), tags, who it is for, waiting for a reply and the reply date. Only the fields given change." + ASK,
    input: z.object({
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(300).optional(),
      addToNotes: z.string().max(5_000).optional().describe("Text added as a new line at the end of the notes"),
      addSteps: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
      tickSteps: z.array(z.number().int().min(1)).max(50).optional().describe("Step numbers to tick (1 = first)"),
      untickSteps: z.array(z.number().int().min(1)).max(50).optional(),
      ...taskFields,
    }),
    run: safely(async (ctx, a) => {
      const n = await new Lookups(ctx).names();
      const t = await loadTask(ctx, String(a.id));
      const body: Record<string, unknown> = await taskBody(ctx, n, a);
      if (a.title) body.title = a.title;
      if (a.addToNotes) body.notes = [(body.notes as string | undefined) ?? t.notes, String(a.addToNotes)].filter(Boolean).join("\n");
      if (a.addSteps || a.tickSteps || a.untickSteps) {
        const list: ChecklistItem[] = t.checklist.map((s) => ({ ...s }));
        for (const [nums, value] of [[a.tickSteps, true], [a.untickSteps, false]] as const)
          for (const i of (nums as number[] | undefined) ?? []) {
            const s = list[i - 1];
            if (!s) throw new Unclear(`The task has ${list.length} steps; there is no step ${i}.`);
            s.done = value;
            if (value) delete s.waiting;
          }
        for (const text of (a.addSteps as string[] | undefined) ?? []) list.push({ id: stepId(), text, done: false });
        body.checklist = list;
      }
      if (!Object.keys(body).length) return { data: { error: "Nothing to change was given" } };
      await ctx.send("PATCH", `/tasks/${t.id}`, body);
      return done(ctx, t.id, "Task changed");
    }),
  },

  {
    name: "complete_tasks",
    title: "Complete tasks",
    write: true,
    description: `Tick tasks as done (up to ${MAX_ITEMS}), as the tick in the app: a reminder's date, a register entry or the email's done label follow. "Contract ends" and "Probation declaration" tasks are not ticked here; they ask a question in WorkDesk.` + ASK,
    input: z.object({ ids: ids("tasks") }),
    run: safely(async (ctx, a) => {
      const n = await new Lookups(ctx).names();
      const out = [];
      const touched: Touched[] = [];
      for (const id of a.ids as string[]) {
        const t = await loadTask(ctx, id);
        if (t.systemKind === "contract" || t.systemKind === "probation") {
          out.push({ id, title: t.title, result: "Not ticked: choose Renew / Contract ended or Declared / Change due date in WorkDesk" });
          continue;
        }
        await ctx.send("POST", `/tasks/${id}/complete`);
        out.push({ id, title: t.title, result: t.status === "done" ? "was already done" : "completed" });
        touched.push(taskTouched(t));
      }
      return { data: { tasks: out, note: "Undo with reopen_tasks." }, touched };
    }),
  },

  {
    name: "reopen_tasks",
    title: "Reopen tasks",
    write: true,
    description: `Put completed tasks back on the to-do list (up to ${MAX_ITEMS}); what followed the tick (reminder date, register entry, labels) goes back too.` + ASK,
    input: z.object({ ids: ids("tasks") }),
    run: safely(async (ctx, a) => {
      const out = [];
      const touched: Touched[] = [];
      for (const id of a.ids as string[]) {
        const t = await loadTask(ctx, id);
        await ctx.send("POST", `/tasks/${id}/reopen`);
        out.push({ id, title: t.title, result: t.status === "open" ? "was already open" : "reopened" });
        touched.push(taskTouched(t));
      }
      return { data: { tasks: out }, touched };
    }),
  },

  {
    name: "add_emails_to",
    title: "Add emails to a task or event",
    write: true,
    description: `Add Pending emails (up to ${MAX_ITEMS}) to a task or an event, as Add email in its details: they leave Pending and behave like its first email (a new reply flags the task).` + ASK,
    input: z.object({ emailIds: ids("emails"), taskId: z.string().uuid().optional(), eventId: z.string().uuid().optional() }),
    run: safely(async (ctx, a) => {
      if (!a.taskId === !a.eventId) return { data: { error: "Give either taskId or eventId" } };
      const owner = a.taskId ? { taskId: a.taskId } : { eventId: a.eventId };
      const r = await ctx.send<{ added: number; skipped: number }>("POST", "/linked-emails", { ...owner, threadIds: a.emailIds });
      const touched: Touched[] = [];
      for (const id of a.emailIds as string[]) touched.push({ kind: "email", id, title: (await ctx.api<Thread>(`/threads/${id}`)).subject });
      if (a.taskId) touched.push(taskTouched(await loadTask(ctx, String(a.taskId))));
      else touched.push({ kind: "event", id: String(a.eventId), title: (await ctx.api<{ events: OfficeEvent[] }>("/office-events")).events.find((e) => e.id === a.eventId)?.title ?? "" });
      return { data: { added: r.added, skipped: r.skipped || undefined, note: r.skipped ? "Skipped emails were not waiting for a decision." : undefined }, touched };
    }),
  },

  {
    name: "take_email_off",
    title: "Take an email off a task or event",
    write: true,
    description: "Take an added email off a task or event (not its first email): it goes back to Pending unless another open task has it." + ASK,
    input: z.object({ emailId: z.string().uuid(), taskId: z.string().uuid().optional(), eventId: z.string().uuid().optional() }),
    run: safely(async (ctx, a) => {
      if (!a.taskId === !a.eventId) return { data: { error: "Give either taskId or eventId" } };
      await ctx.send("DELETE", `/linked-emails/${a.emailId}?${a.taskId ? `taskId=${a.taskId}` : `eventId=${a.eventId}`}`);
      const email = await ctx.api<Thread>(`/threads/${a.emailId}`);
      return { data: { done: "Taken off", emailNow: email.state === "needs_decision" ? "back in Pending" : email.state }, touched: [{ kind: "email", id: email.id, title: email.subject }] };
    }),
  },

  {
    name: "remove_emails",
    title: "Remove emails from Pending",
    write: true,
    description: `Remove Pending emails (up to ${MAX_ITEMS}), as Remove in the app: "just remove" changes only WorkDesk (they stay in Gmail, under Removed), or give a section (a Gmail label of another section of the office) to send them there, which adds that label in Gmail. Nothing is deleted; Restore in WorkDesk brings them back.` + ASK,
    input: z.object({ emailIds: ids("emails"), section: z.string().optional().describe("Section (Gmail label) name; leave out to just remove") }),
    run: safely(async (ctx, a) => {
      const emailIds = a.emailIds as string[];
      const before = await Promise.all(emailIds.map((id) => ctx.api<Thread>(`/threads/${id}`)));
      if (a.section) {
        const [{ labels }, s] = await Promise.all([
          ctx.api<{ labels: Label[] }>("/labels"),
          ctx.api<{ taskLabelId: string | null; doneLabelId: string | null; organizeLabelIds: string[] }>("/labels/task-settings"),
        ]);
        const notSections = new Set([s.taskLabelId, s.doneLabelId, ...s.organizeLabelIds]);
        const sections = labels.filter((l) => !notSections.has(l.id));
        const label = sections.find((l) => lower(l.name) === lower(String(a.section)));
        if (!label) return { data: { error: `"${a.section}" isn't a section. Sections: ${sections.map((l) => l.name).join(", ")}` } };
        const r = await ctx.send<{ moved: number }>("POST", "/threads/bulk-section", { ids: emailIds, labelId: label.id });
        return { data: { sentTo: label.name, moved: r.moved, notMoved: emailIds.length - r.moved || undefined }, touched: before.map((t) => ({ kind: "email", id: t.id, title: t.subject })) };
      }
      const r = await ctx.send<{ dismissed: number }>("POST", "/threads/bulk-dismiss", { ids: emailIds });
      return { data: { removed: r.dismissed, notRemoved: emailIds.length - r.dismissed || undefined, note: "Only emails still in Pending are removed." }, touched: before.map((t) => ({ kind: "email", id: t.id, title: t.subject })) };
    }),
  },

  {
    name: "add_register_entry",
    title: "Add a register entry",
    write: true,
    description: "Record a pending entry in one of the office registers: what has to be written in, the employee who has to sign or give the details (or General), and optionally a due date, which also makes a task." + ASK,
    input: z.object({ register: z.string().min(1).describe("Register name"), text: z.string().trim().min(1).max(500), employee: z.string().optional().describe('Who is needed, or "General"'), dueDate: day.optional() }),
    run: safely(async (ctx, a) => {
      const L = new Lookups(ctx);
      const [n, { registers }] = await Promise.all([L.names(), ctx.api<{ registers: Register[] }>("/registers")]);
      const r = registers.find((x) => lower(x.name) === lower(String(a.register)));
      if (!r) return { data: { error: `No register called "${a.register}". Registers: ${registers.map((x) => x.name).join(", ")}` } };
      const e = await ctx.send<{ id: string; taskId: string | null }>("POST", "/register-entries", { registerId: r.id, text: a.text, employeeId: a.employee ? resolveEmployee(n, String(a.employee)) : null, dueDate: a.dueDate ?? null });
      return { data: clean({ done: "Entry added", entryId: e.id, register: r.name, taskId: e.taskId }), touched: [{ kind: "register_entry", id: e.id, title: `${r.name}: ${a.text}` }] };
    }),
  },

  {
    name: "update_register_entry",
    title: "Change a register entry",
    write: true,
    description: "Change a register entry: its text, who is needed, or its due date (a date makes or moves its task; null takes the task away)." + ASK,
    input: z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(500).optional(), employee: z.string().optional().describe('Who is needed, or "General"'), dueDate: day.nullable().optional() }),
    run: safely(async (ctx, a) => {
      const n = await new Lookups(ctx).names();
      const body: Record<string, unknown> = {};
      if (a.text) body.text = a.text;
      if (a.employee !== undefined) body.employeeId = resolveEmployee(n, String(a.employee));
      if (a.dueDate !== undefined) body.dueDate = a.dueDate;
      if (!Object.keys(body).length) return { data: { error: "Nothing to change was given" } };
      await ctx.send("PATCH", `/register-entries/${a.id}`, body);
      const e = (await ctx.api<{ entries: RegisterEntry[] }>("/register-entries")).entries.find((x) => x.id === a.id);
      return { data: { done: "Entry changed" }, touched: [{ kind: "register_entry", id: String(a.id), title: e?.text ?? "" }] };
    }),
  },

  {
    name: "set_register_entry_done",
    title: "Tick a register entry",
    write: true,
    description: "Tick a register entry as written in (done), or set it back to pending; its task follows." + ASK,
    input: z.object({ id: z.string().uuid(), done: z.boolean() }),
    run: safely(async (ctx, a) => {
      await ctx.send("POST", `/register-entries/${a.id}/done`, { done: a.done });
      const e = (await ctx.api<{ entries: RegisterEntry[] }>("/register-entries")).entries.find((x) => x.id === a.id);
      return { data: { done: a.done ? "Entry done" : "Entry pending again" }, touched: [{ kind: "register_entry", id: String(a.id), title: e?.text ?? "" }] };
    }),
  },

  {
    name: "create_event",
    title: "Create an event",
    write: true,
    description:
      "Add a meeting, training, programme or other event, as in the Events page: title, type, date, start / end time, venue, meeting link, organiser, attendees (employee names), notes, repeat, and an optional preparation task. Give emailId to make it from an email (the email leaves Pending, tagged Event)." + ASK,
    input: z.object({
      title: z.string().trim().min(1).max(300),
      date: day,
      type: z.string().optional().describe("Event type name (Meeting, Training, Programme…)"),
      startTime: time.optional(),
      endTime: time.optional(),
      venue: z.string().max(300).optional(),
      meetingLink: z.string().max(2000).optional(),
      organiser: z.string().max(200).optional(),
      attendees: z.array(z.string()).max(100).optional().describe("Employee names, or a designation as \"All Staff Nurse\""),
      notes: z.string().max(10_000).optional(),
      repeat: z.enum(REPEATS).optional(),
      repeatUntil: day.optional(),
      prepDaysBefore: z.number().int().min(0).max(60).optional().describe("Make a preparation task this many days before (0 = on the day)"),
      emailId: z.string().uuid().optional(),
    }),
    run: safely(async (ctx, a) => {
      const L = new Lookups(ctx);
      const [n, { types }] = await Promise.all([L.names(), ctx.api<{ types: EventType[] }>("/event-types")]);
      let typeId: string | null = null;
      if (a.type) {
        const t = types.find((x) => lower(x.name) === lower(String(a.type)));
        if (!t) return { data: { error: `No event type "${a.type}". Types: ${types.map((x) => x.name).join(", ")}` } };
        typeId = t.id;
      }
      const attendeeIds: string[] = [];
      for (const name of (a.attendees as string[] | undefined) ?? []) {
        const f = resolveFor(n, name);
        if (f.relatedKind === "employee") attendeeIds.push(f.relatedId!);
        else if (f.relatedKind === "designation") attendeeIds.push(...[...n.employee.values()].filter((e) => !e.leftOn && e.designationId === f.relatedId).map((e) => e.id));
      }
      const ev = await ctx.send<OfficeEvent>("POST", "/office-events", {
        title: a.title,
        startDate: a.date,
        typeId,
        startTime: a.startTime ?? null,
        endTime: a.endTime ?? null,
        venue: a.venue ?? "",
        meetingUrl: a.meetingLink ?? "",
        organiser: a.organiser ?? "",
        attendeeIds: [...new Set(attendeeIds)],
        notes: a.notes ?? "",
        repeat: a.repeat ?? "never",
        endDate: a.repeatUntil ?? null,
        prepDays: a.prepDaysBefore ?? null,
        threadId: a.emailId ?? null,
      });
      return {
        data: clean({ done: "Event created", eventId: ev.id, title: ev.title, type: ev.typeName || "Event", date: ev.startDate, attendees: ev.attendeeIds.length || undefined }),
        touched: [{ kind: "event", id: ev.id, title: ev.title }, ...(a.emailId ? [{ kind: "email", id: String(a.emailId), title: "" }] : [])],
      };
    }),
  },

  {
    name: "set_event_date",
    title: "Change one date of an event",
    write: true,
    description: 'Mark one date of an event (its scheduled date, from list_events: the "movedFrom" date if it was moved) as done or cancelled, move it to another day / time, set it back to scheduled, or back to its original date.' + ASK,
    input: z.object({
      eventId: z.string().uuid(),
      date: day.describe("The date the schedule gave it"),
      status: z.enum(["done", "cancelled", "moved", "scheduled", "original"]),
      newDate: day.optional().describe("For moved"),
      newStartTime: time.nullable().optional(),
      newEndTime: time.nullable().optional(),
    }),
    run: safely(async (ctx, a) => {
      if (a.status === "moved" && !a.newDate) return { data: { error: "Give newDate for a move" } };
      await ctx.send("POST", `/office-events/${a.eventId}/occurrence`, {
        date: a.date,
        status: a.status,
        ...(a.newDate ? { newDate: a.newDate } : {}),
        ...(a.newStartTime !== undefined ? { newTime: a.newStartTime } : {}),
        ...(a.newEndTime !== undefined ? { newEndTime: a.newEndTime } : {}),
      });
      const ev = (await ctx.api<{ events: OfficeEvent[] }>("/office-events")).events.find((e) => e.id === a.eventId);
      return { data: { done: `Event date ${a.status === "original" ? "back on its own date" : a.status}` }, touched: [{ kind: "event", id: String(a.eventId), title: ev?.title ?? "" }] };
    }),
  },

  {
    name: "create_reminder",
    title: "Create a reminder",
    write: true,
    description: "Add a reminder, as the reminder form: a name, the first date, an optional time, how it repeats and until when, how many days before each date its task shows, priority, notes, links (e.g. the Google Sheet to fill), tags and who it is for. Each date becomes a task." + ASK,
    input: z.object({ name: z.string().trim().min(1).max(120), ...reminderFields, date: day }),
    run: safely(async (ctx, a) => {
      const n = await new Lookups(ctx).names();
      const r = await ctx.send<{ id: string; name: string }>("POST", "/reports", await reminderBody(ctx, n, a));
      return { data: { done: "Reminder created", reminderId: r.id, name: r.name }, touched: [reminderTouched(r)] };
    }),
  },

  {
    name: "update_reminder",
    title: "Change a reminder",
    write: true,
    description: "Change a reminder: only the fields given change; paused: true pauses it (no new dates), false resumes it. Schedule changes apply to dates not made yet; dates already made keep theirs." + ASK,
    input: z.object({ reminder: z.string().describe("Its name (part is enough) or id"), name: z.string().trim().min(1).max(120).optional(), paused: z.boolean().optional(), ...reminderFields }),
    run: safely(async (ctx, a) => {
      const L = new Lookups(ctx);
      const [n, { reports }] = await Promise.all([L.names(), ctx.api<{ reports: Report[] }>("/reports")]);
      const r = pick(reports, String(a.reminder), (x) => x.name, "reminder");
      const { reminder: _r, paused, ...rest } = a;
      const body = await reminderBody(ctx, n, rest);
      if (paused !== undefined) body.active = !paused;
      if (!Object.keys(body).length) return { data: { error: "Nothing to change was given" } };
      await ctx.send("PATCH", `/reports/${r.id}`, body);
      return { data: { done: paused === true ? "Reminder paused" : paused === false ? "Reminder resumed" : "Reminder changed", reminder: (body.name as string) ?? r.name }, touched: [reminderTouched(r)] };
    }),
  },

  {
    name: "set_reminder_date",
    title: "Mark a reminder date done",
    write: true,
    description: "Mark one date of a reminder as done (submitted), or back to pending; its task follows. The date must already be made (list_reminders shows the pending dates)." + ASK,
    input: z.object({ reminder: z.string().describe("Its name (part is enough) or id"), date: day, done: z.boolean() }),
    run: safely(async (ctx, a) => {
      const { reports } = await ctx.api<{ reports: Report[] }>("/reports");
      const r = pick(reports, String(a.reminder), (x) => x.name, "reminder");
      const p = r.periods.find((x) => x.dueDate === a.date);
      if (!p) return { data: { error: `${r.name} has no date ${a.date} yet. Its dates: ${r.periods.slice(0, 6).map((x) => `${x.dueDate} (${x.status === "submitted" ? "done" : "pending"})`).join(", ") || "none made yet"}` } };
      await ctx.send("POST", `/reports/periods/${p.id}/${a.done ? "submit" : "reopen"}`);
      return { data: { done: `${r.name}, ${a.date}: ${a.done ? "done" : "pending again"}` }, touched: [reminderTouched(r)] };
    }),
  },

  {
    name: "add_file",
    title: "Add to the file register",
    write: true,
    description: "Add a file to the file register: subject, physical file or e-file, the e-file number (or none yet), notes and tags. An e-file number can belong to only one entry." + ASK,
    input: z.object({
      subject: z.string().trim().min(1).max(200),
      kind: z.enum(["physical", "e-file"]).optional().describe("Default physical"),
      eFileNumber: z.string().trim().max(50).optional(),
      notes: z.string().max(2_000).optional(),
      tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    }),
    run: safely(async (ctx, a) => {
      const f = await ctx.send<OfficeFile>("POST", "/files", {
        subject: a.subject,
        physical: a.kind !== "e-file",
        efileNumber: a.eFileNumber ?? "",
        notes: a.notes ?? "",
        tagIds: a.tags ? await resolveTags(ctx, a.tags as string[]) : [],
      });
      return { data: clean({ done: "Added to the file register", fileId: f.id, subject: f.subject, eFileNumber: f.efileNumber || "not created yet" }), touched: [fileTouched(f)] };
    }),
  },

  {
    name: "update_file",
    title: "Change a file register entry",
    write: true,
    description: 'Change a file register entry, found by its subject (part is enough), e-file number or id: subject, kind, e-file number ("the e-file is now …"; "" = not created), notes, tags. Only the fields given change.' + ASK,
    input: z.object({
      file: z.string().describe("Subject words, e-file number or id"),
      subject: z.string().trim().min(1).max(200).optional(),
      kind: z.enum(["physical", "e-file"]).optional(),
      eFileNumber: z.string().trim().max(50).optional(),
      notes: z.string().max(2_000).optional(),
      tags: z.array(z.string().min(1).max(40)).max(20).optional().describe("Replaces the tags"),
    }),
    run: safely(async (ctx, a) => {
      const { files } = await ctx.api<{ files: OfficeFile[] }>("/files");
      const byNumber = files.filter((f) => f.efileNumber && lower(f.efileNumber) === lower(String(a.file)));
      const f = byNumber.length === 1 ? byNumber[0]! : pick(files, String(a.file), (x) => x.subject, "file register entry");
      if ([a.subject, a.kind, a.eFileNumber, a.notes, a.tags].every((v) => v === undefined)) return { data: { error: "Nothing to change was given" } };
      await ctx.send("PUT", `/files/${f.id}`, {
        subject: a.subject ?? f.subject,
        physical: a.kind ? a.kind !== "e-file" : f.physical,
        efileNumber: a.eFileNumber ?? f.efileNumber,
        notes: a.notes ?? f.notes,
        tagIds: a.tags ? await resolveTags(ctx, a.tags as string[]) : f.tagIds,
      });
      return { data: clean({ done: "File register entry changed", subject: a.subject ?? f.subject, eFileNumber: (a.eFileNumber ?? f.efileNumber) || "not created yet" }), touched: [fileTouched(f)] };
    }),
  },
];
