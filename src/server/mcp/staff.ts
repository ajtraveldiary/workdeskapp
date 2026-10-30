// The assistant's staff actions (MCP Phase 4, user request 2026-10-18; docs/MCP_PLAN.md): joining and relieving
// with their steps, increments with the new basic pay, renewing or ending a contract, declaring probation, marking a
// register updated, and adding or changing an employee. Made through the app's own routes (ctx.send), exactly as the
// Employees page and Settings › Employees make them. They need both Allow changes and Allow staff actions in
// Settings › Assistant (server.ts checks), share the hourly limit and are logged like every change.
import { z } from "zod";
import { MOVE_LABEL, MOVE_STEPS, STEP_STATES, type MoveKind } from "../../shared/moves";
import { EMPLOYEE_CATEGORIES, ENGAGEMENT_LABELS, contractEnd, incrementDue, type Engagement } from "../../shared/staff";
import type { Employee, Register, StaffList, StaffMove } from "../../shared/types";
import { Lookups, clean, type Tool, type ToolCtx } from "./tools";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const ASK = " Before calling, tell the user exactly what will change and wait for their yes.";

export class Unclear extends Error {}
export const safely =
  (run: Tool["run"]): Tool["run"] =>
  async (ctx, a) => {
    try {
      return await run(ctx, a);
    } catch (e) {
      if (e instanceof Unclear) return { data: { error: e.message } };
      throw e;
    }
  };

// An employee by id or name (part of the name is enough when only one fits). withLeft: also those who left.
export function findEmployee(s: StaffList, text: string, withLeft = true): Employee {
  const q = lower(text);
  const pool = s.employees.filter((e) => withLeft || !e.leftOn);
  const byId = pool.find((e) => e.id === text);
  if (byId) return byId;
  const exact = pool.filter((e) => lower(e.name) === q || (!!e.pen && lower(e.pen) === q));
  const found = exact.length ? exact : pool.filter((e) => lower(e.name).includes(q));
  if (found.length === 1) return found[0]!;
  const desig = new Map(s.designations.map((d) => [d.id, d.name]));
  if (found.length)
    throw new Unclear(`"${text}" could be: ${found.map((e) => `${e.name}${e.designationId ? ` (${desig.get(e.designationId)})` : ""}${e.leftOn ? ", left" : ""}`).join("; ")}. Give the name in full or the id.`);
  throw new Unclear(`No employee called "${text}". To add someone new, use add_employee.`);
}

// Joining / relieving steps by their name ("SPARK", "service book"…): the app's step ids.
function stepIds(kind: MoveKind, names: string[]): string[] {
  return names.map((name) => {
    const q = lower(name);
    const found = MOVE_STEPS[kind].filter((s) => s.id === name || lower(s.text) === q || lower(s.short) === q || lower(s.text).includes(q) || lower(s.short).includes(q));
    if (found.length !== 1) throw new Unclear(`${MOVE_LABEL[kind]} steps are: ${MOVE_STEPS[kind].map((s) => s.text).join("; ")}. "${name}" ${found.length ? "fits more than one" : "isn't one of them"}.`);
    return found[0]!.id;
  });
}

const employeeTouched = (e: { id: string; name: string }) => ({ kind: "employee", id: e.id, title: e.name });
const staffOf = (ctx: ToolCtx) => ctx.api<StaffList>("/staff");

// The fields of the employee form, in plain words; dates YYYY-MM-DD, null clears.
const employeeFields = {
  designation: z.string().optional().describe("Designation name (from Settings › Employees)"),
  pen: z.string().max(20).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().max(200).optional(),
  dateOfBirth: day.nullable().optional(),
  category: z.enum(EMPLOYEE_CATEGORIES).optional(),
  joinedService: day.nullable().optional().describe("Permanent: date of joining service. Temporary: date of joining"),
  joinedThisOffice: day.nullable().optional().describe("Permanent only"),
  nextIncrement: day.nullable().optional().describe("Permanent only"),
  retires: day.nullable().optional().describe("Permanent only"),
  payScale: z.string().max(100).optional().describe("Permanent only"),
  basicPay: z.number().min(0).max(10_000_000).nullable().optional().describe("Permanent only, in rupees"),
  probationDeclared: day.nullable().optional().describe("Permanent only"),
  address: z.string().max(500).optional().describe("Permanent only"),
  notes: z.string().max(5_000).optional().describe("Permanent only"),
  engagedAs: z.enum(["Contract", "Daily wage", "Temporary"]).optional().describe("Temporary only"),
  type: z.string().optional().describe("Temporary only: type such as HMC or NHM (from Settings › Employees)"),
  contractDays: z.number().int().min(1).max(3650).nullable().optional().describe("Temporary only"),
  payPerDay: z.number().min(0).max(1_000_000).nullable().optional().describe("Temporary only, in rupees"),
  contractEnds: day.nullable().optional().describe("Temporary only"),
};
const FIELD_KEY: Record<string, keyof Employee> = {
  pen: "pen",
  phone: "phone",
  email: "email",
  dateOfBirth: "dateOfBirth",
  category: "category",
  joinedService: "joinedServiceOn",
  joinedThisOffice: "joinedOfficeOn",
  nextIncrement: "nextIncrementOn",
  retires: "retiresOn",
  payScale: "payScale",
  basicPay: "basicPay",
  probationDeclared: "probationDeclaredOn",
  address: "address",
  notes: "notes",
  contractDays: "contractDays",
  payPerDay: "payPerDay",
  contractEnds: "engagedTill",
};

// The employee form as the app sends it (every field), from what is there now plus what the assistant gave.
function employeeForm(s: StaffList, base: Partial<Employee>, a: Record<string, unknown>) {
  const form: Record<string, unknown> = {
    name: base.name ?? "",
    designationId: base.designationId ?? null,
    permanent: base.permanent ?? true,
    engagedTill: base.engagedTill ?? null,
    engagement: base.engagement ?? "",
    typeId: base.typeId ?? null,
    contractDays: base.contractDays ?? null,
    payPerDay: base.payPerDay ?? null,
    pen: base.pen ?? "",
    phone: base.phone ?? "",
    email: base.email ?? "",
    dateOfBirth: base.dateOfBirth ?? null,
    category: base.category ?? "",
    joinedServiceOn: base.joinedServiceOn ?? null,
    joinedOfficeOn: base.joinedOfficeOn ?? null,
    nextIncrementOn: base.nextIncrementOn ?? null,
    retiresOn: base.retiresOn ?? null,
    payScale: base.payScale ?? "",
    basicPay: base.basicPay ?? null,
    probationDeclaredOn: base.probationDeclaredOn ?? null,
    address: base.address ?? "",
    notes: base.notes ?? "",
  };
  if (a.name) form.name = a.name;
  if (a.employment) form.permanent = a.employment === "permanent";
  if (a.designation !== undefined) {
    const d = s.designations.find((x) => lower(x.name) === lower(String(a.designation)));
    if (!d && a.designation) throw new Unclear(`No designation "${a.designation}". Designations: ${s.designations.map((x) => x.name).join(", ")}`);
    form.designationId = d?.id ?? null;
  }
  if (a.type !== undefined) {
    const t = s.types.find((x) => lower(x.name) === lower(String(a.type)));
    if (!t && a.type) throw new Unclear(`No type "${a.type}". Types: ${s.types.map((x) => x.name).join(", ")}`);
    form.typeId = t?.id ?? null;
  }
  if (a.engagedAs) form.engagement = (Object.entries(ENGAGEMENT_LABELS).find(([, label]) => label === a.engagedAs)?.[0] ?? "") as Engagement | "";
  for (const [k, key] of Object.entries(FIELD_KEY)) if (a[k] !== undefined) form[key] = a[k] ?? (typeof form[key] === "string" ? "" : null);
  // Temporary staff: the contract end from joining + days, as the form fills it in, unless one is given.
  if (!form.permanent && a.contractEnds === undefined && form.joinedServiceOn && form.contractDays && (a.joinedService !== undefined || a.contractDays !== undefined || !form.engagedTill))
    form.engagedTill = contractEnd(String(form.joinedServiceOn), Number(form.contractDays));
  return form;
}

const employeeAnswer = async (ctx: ToolCtx, id: string, note: string) => {
  const s = await staffOf(ctx);
  const e = s.employees.find((x) => x.id === id)!;
  const n = await new Lookups(ctx).names();
  const desig = e.designationId ? n.designation.get(e.designationId) : null;
  return { data: clean({ done: note, employee: { id: e.id, name: e.name, designation: desig, employment: e.permanent ? "Permanent" : "Temporary" } }), touched: [employeeTouched(e)] };
};

export const STAFF_TOOLS: Tool[] = [
  {
    name: "join_employee",
    title: "Join an employee",
    write: true,
    staff: true,
    description:
      `Record an employee joining the office, as Join on the Employees page: their "joined this office" date becomes the date, and a Joining task is made with the steps ${MOVE_STEPS.join.map((s) => s.text).join(", ")}. Give the steps already done. For someone not in WorkDesk yet, use add_employee first.` + ASK,
    input: z.object({ employee: z.string().describe("Name, PEN or id"), date: day, stepsDone: z.array(z.string()).max(10).optional() }),
    run: safely(async (ctx, a) => {
      const e = findEmployee(await staffOf(ctx), String(a.employee));
      const doneSteps = stepIds("join", (a.stepsDone as string[]) ?? []);
      const r = await ctx.send<{ id: string; taskId: string }>("POST", "/moves", { employeeId: e.id, kind: "join", date: a.date, doneSteps });
      return { data: { done: `${e.name} joined on ${a.date}`, joiningTaskId: r.taskId, stepsDone: doneSteps.length }, touched: [employeeTouched(e), { kind: "task", id: r.taskId, title: `Joining: ${e.name}` }] };
    }),
  },

  {
    name: "relieve_employee",
    title: "Relieve an employee",
    write: true,
    staff: true,
    description:
      `Record an employee being relieved, as Relieve on the Employees page: they are marked as left the office on the date, and a Relieving task is made with the steps ${MOVE_STEPS.relieve.map((s) => s.text).join(", ")}. Give the steps already done.` + ASK,
    input: z.object({ employee: z.string().describe("Name, PEN or id"), date: day, stepsDone: z.array(z.string()).max(10).optional() }),
    run: safely(async (ctx, a) => {
      const e = findEmployee(await staffOf(ctx), String(a.employee));
      const doneSteps = stepIds("relieve", (a.stepsDone as string[]) ?? []);
      const r = await ctx.send<{ id: string; taskId: string }>("POST", "/moves", { employeeId: e.id, kind: "relieve", date: a.date, doneSteps });
      return { data: { done: `${e.name} relieved on ${a.date}`, relievingTaskId: r.taskId, stepsDone: doneSteps.length }, touched: [employeeTouched(e), { kind: "task", id: r.taskId, title: `Relieving: ${e.name}` }] };
    }),
  },

  {
    name: "set_joining_step",
    title: "Set a joining / relieving step",
    write: true,
    staff: true,
    description: "Set one step of an employee's latest joining or relieving to Pending, Waiting or Done, as in the Joining & relieving table; the task's steps follow, and it completes itself when every step is done." + ASK,
    input: z.object({ employee: z.string(), kind: z.enum(["join", "relieve"]).optional().describe("Default: their latest record"), step: z.string().describe("Step name, e.g. SPARK or service book"), state: z.enum(STEP_STATES) }),
    run: safely(async (ctx, a) => {
      const e = findEmployee(await staffOf(ctx), String(a.employee));
      const { moves } = await ctx.api<{ moves: StaffMove[] }>("/moves");
      const m = moves.find((x) => x.employeeId === e.id && (!a.kind || x.kind === a.kind));
      if (!m) return { data: { error: `${e.name} has no ${a.kind ? MOVE_LABEL[a.kind as MoveKind].toLowerCase() : "joining or relieving"} record` } };
      const [step] = stepIds(m.kind, [String(a.step)]);
      await ctx.send("POST", `/moves/${m.id}/step`, { step, state: a.state });
      const def = MOVE_STEPS[m.kind].find((s) => s.id === step)!;
      return { data: { done: `${MOVE_LABEL[m.kind]} of ${e.name}: ${def.text} is now ${a.state === "done" ? def.doneLabel : a.state === "waiting" ? "Waiting" : "Pending"}` }, touched: [employeeTouched(e), ...(m.taskId ? [{ kind: "task", id: m.taskId, title: `${MOVE_LABEL[m.kind]}: ${e.name}` }] : [])] };
    }),
  },

  {
    name: "mark_increment_done",
    title: "Mark an increment done",
    write: true,
    staff: true,
    description: "Mark a permanent employee's due increment as done, as Mark done in Due increments: the next increment date moves a year on and the new basic pay (in rupees) is saved. Only for increments due this month or earlier." + ASK,
    input: z.object({ employee: z.string(), newBasicPay: z.number().min(0).max(10_000_000).optional().describe("New basic pay in rupees; leave out to keep it") }),
    run: safely(async (ctx, a) => {
      const e = findEmployee(await staffOf(ctx), String(a.employee), false);
      if (!e.nextIncrementOn) return { data: { error: `${e.name} has no increment date` } };
      if (!incrementDue(e.nextIncrementOn, ctx.today)) return { data: { error: `${e.name}'s increment isn't due until ${e.nextIncrementOn}` } };
      const r = await ctx.send<{ next: string; previousBasicPay: number | null; basicPay: number | null }>("POST", `/staff/employees/${e.id}/increment`, a.newBasicPay !== undefined ? { basicPay: a.newBasicPay } : {});
      return { data: clean({ done: `Increment for ${e.name} (due ${e.nextIncrementOn}) done`, nextIncrement: r.next, basicPay: r.basicPay !== r.previousBasicPay ? `₹${r.previousBasicPay ?? "?"} → ₹${r.basicPay ?? "?"}` : null }), touched: [employeeTouched(e)] };
    }),
  },

  {
    name: "renew_or_end_contract",
    title: "Renew or end a contract",
    write: true,
    staff: true,
    description: "For a temporary employee whose contract is ending, as the Contract ends task asks: renew for the same number of days from the day after it ends, or end it (they leave the office on the end date). Their Contract ends task is completed." + ASK,
    input: z.object({ employee: z.string(), choice: z.enum(["renew", "end"]) }),
    run: safely(async (ctx, a) => {
      const e = findEmployee(await staffOf(ctx), String(a.employee), false);
      if (a.choice === "renew") {
        const r = await ctx.send<{ previous: string; next: string }>("POST", `/staff/employees/${e.id}/contract/renew`, {});
        return { data: { done: `Contract of ${e.name} renewed`, ended: r.previous, nowEnds: r.next }, touched: [employeeTouched(e)] };
      }
      const r = await ctx.send<{ leftOn: string }>("POST", `/staff/employees/${e.id}/contract/ended`, {});
      return { data: { done: `Contract of ${e.name} ended; left the office on ${r.leftOn}` }, touched: [employeeTouched(e)] };
    }),
  },

  {
    name: "declare_probation",
    title: "Declare probation",
    write: true,
    staff: true,
    description: "Record that a permanent employee's probation is declared today, as the Probation declaration task asks; that task is completed. For another date, use update_employee with probationDeclared; to give the task a new due date, use update_task." + ASK,
    input: z.object({ employee: z.string() }),
    run: safely(async (ctx, a) => {
      const e = findEmployee(await staffOf(ctx), String(a.employee), false);
      const r = await ctx.send<{ declaredOn: string }>("POST", `/staff/employees/${e.id}/probation`, {});
      return { data: { done: `Probation of ${e.name} declared on ${r.declaredOn}` }, touched: [employeeTouched(e)] };
    }),
  },

  {
    name: "mark_register_updated",
    title: "Mark a register updated",
    write: true,
    staff: true,
    description: "Mark an office register as updated until a date (default today), as its Updated button: the date is saved and its done entries are cleared from the list (their completed tasks stay)." + ASK,
    input: z.object({ register: z.string(), date: day.optional() }),
    run: safely(async (ctx, a) => {
      const { registers } = await ctx.api<{ registers: Register[] }>("/registers");
      const r = registers.find((x) => lower(x.name) === lower(String(a.register)));
      if (!r) return { data: { error: `No register called "${a.register}". Registers: ${registers.map((x) => x.name).join(", ")}` } };
      if (a.date && String(a.date) > ctx.today) return { data: { error: "A register can't be updated until a future date" } };
      const out = await ctx.send<{ cleared: number }>("POST", `/registers/${r.id}/updated`, a.date ? { date: a.date } : {});
      return { data: { done: `${r.name} updated until ${a.date ?? ctx.today}`, doneEntriesCleared: out.cleared }, touched: [{ kind: "register", id: r.id, title: r.name }] };
    }),
  },

  {
    name: "add_employee",
    title: "Add an employee",
    write: true,
    staff: true,
    description: "Add an employee, as the employee form: name, permanent or temporary, designation and the other details. Joining the office is a separate step (join_employee)." + ASK,
    input: z.object({ name: z.string().trim().min(1).max(120), employment: z.enum(["permanent", "temporary"]), ...employeeFields }),
    run: safely(async (ctx, a) => {
      const s = await staffOf(ctx);
      const dup = s.employees.find((e) => lower(e.name) === lower(String(a.name)) && !e.leftOn);
      if (dup) return { data: { error: `${dup.name} is already in WorkDesk (id ${dup.id}); use update_employee to change their details` } };
      const e = await ctx.send<Employee>("POST", "/staff/employees", employeeForm(s, {}, a));
      return employeeAnswer(ctx, e.id, `${e.name} added`);
    }),
  },

  {
    name: "update_employee",
    title: "Change an employee's details",
    write: true,
    staff: true,
    description: "Change an employee's details, as the employee form; only the fields given change (null or an empty text clears one). Switching permanent / temporary clears the other kind's details, as the form does." + ASK,
    input: z.object({ employee: z.string().describe("Name, PEN or id"), name: z.string().trim().min(1).max(120).optional(), employment: z.enum(["permanent", "temporary"]).optional(), ...employeeFields }),
    run: safely(async (ctx, a) => {
      const s = await staffOf(ctx);
      const e = findEmployee(s, String(a.employee));
      const { employee: _who, ...changes } = a;
      if (!Object.values(changes).some((v) => v !== undefined)) return { data: { error: "Nothing to change was given" } };
      await ctx.send("PUT", `/staff/employees/${e.id}`, employeeForm(s, e, changes));
      return employeeAnswer(ctx, e.id, `${e.name}'s details changed`);
    }),
  },
];
