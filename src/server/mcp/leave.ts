// Leave for assistants (user request 2026-10-30, docs/LEAVE_PLAN.md phase 4): read an employee's leave account, and
// mark a leave as Mark leave does (a staff action: needs Allow changes and Allow staff actions, logged like every
// change). Both go through the app's own routes as the user.
import { z } from "zod";
import { calendarDays, formatDays, leaveEnd, leaveShort, leaveSteps, rejoinDay } from "../../shared/leave";
import type { EmployeeLeave, LeaveAccount, LeavePostponed, LeaveType, StaffList } from "../../shared/types";
import { clean, type Tool, type ToolCtx } from "./tools";
import { Unclear, findEmployee, safely } from "./staff";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const ASK = " Before calling, tell the user exactly what will change and wait for their yes.";

const typesOf = async (ctx: ToolCtx) => (await ctx.api<{ types: LeaveType[] }>("/leave/types")).types;

// A leave type by short name or name ("HPL", "half pay", "EOL").
function findType(types: LeaveType[], text: string): LeaveType {
  const q = lower(text);
  const exact = types.filter((t) => lower(t.short) === q || lower(t.name) === q);
  const found = exact.length ? exact : types.filter((t) => lower(t.name).includes(q) || lower(t.short).includes(q));
  if (found.length === 1) return found[0]!;
  throw new Unclear(`Leave types are: ${types.map((t) => `${t.name} (${leaveShort(t)})`).join("; ") || "none yet (Settings › Leave)"}. "${text}" ${found.length ? "fits more than one" : "isn't one of them"}.`);
}

function leaveState(l: EmployeeLeave, today: string) {
  if (l.status === "cancelled") return "Cancelled";
  if (l.rejoinedOn && l.rejoinedOn <= today) return "Rejoined";
  if (today < l.fromDate) return "Upcoming";
  return today <= leaveEnd(l) ? "On leave" : "Due back (no joining report yet)";
}

export const LEAVE_READ_TOOLS: Tool[] = [
  {
    name: "get_leave_account",
    title: "Leave account",
    description:
      "One permanent employee's leave account: the balance of each leave that keeps one (EL, HPL…), days used against a limit in the whole service (LND 360), their leaves (type, dates, days, state, paperwork steps done) and the latest account lines (opening balance, credits, leave taken, days given back, lapsed, surrendered).",
    input: z.object({ employee: z.string().describe("Name, PEN or id") }),
    run: safely(async (ctx, a) => {
      const [staff, types] = await Promise.all([ctx.api<StaffList>("/staff"), typesOf(ctx)]);
      const e = findEmployee(staff, String(a.employee));
      if (!e.permanent) return { data: { error: `${e.name} is a temporary employee; leave accounts are kept for permanent staff` } };
      const [acc, leaves] = await Promise.all([ctx.api<LeaveAccount>(`/leave/accounts/${e.id}`), ctx.api<{ today: string; leaves: EmployeeLeave[] }>(`/leave/leaves?employeeId=${e.id}`)]);
      const name = (id: string) => {
        const t = types.find((x) => x.id === id);
        return t ? leaveShort(t) : "Leave";
      };
      return {
        data: clean({
          employee: e.name,
          gazetted: e.gazetted,
          probationDeclared: e.probationDeclared || !!e.probationDeclaredOn,
          balances: acc.balances.map((b) => ({ leave: name(b.typeId), days: b.balance })),
          usedAgainstLimit: types
            .filter((t) => t.serviceLimit != null)
            .map((t) => ({ leave: leaveShort(t), used: acc.used.find((u) => u.typeId === t.id)?.days ?? 0, limit: t.serviceLimit })),
          leaves: leaves.leaves.map((l) => ({
            id: l.id,
            leave: name(l.typeId),
            from: l.fromDate,
            to: leaveEnd(l),
            days: l.days,
            state: leaveState(l, ctx.today),
            dueBack: l.status === "active" ? rejoinDay(l) : null,
            order: l.orderNo || null,
            steps: l.task ? `${l.task.checklist.filter((i) => i.done).length} of ${l.task.checklist.length} done` : null,
            taskId: l.task?.id,
          })),
          accountLines: acc.lines.slice(0, 40).map((l) => ({ date: l.onDate, leave: name(l.typeId), kind: l.kind, days: l.days, forYear: l.creditFor, note: l.note || null })),
        }),
      };
    }),
  },
];

export const LEAVE_STAFF_TOOLS: Tool[] = [
  {
    name: "mark_leave",
    title: "Mark leave",
    write: true,
    staff: true,
    description:
      "Mark a leave for a permanent employee, as Mark leave on their page: the days come off the balance (commuted leave takes 2 days of HPL a day; LND may take HPL below zero; EOL takes nothing) and a task is made with the paperwork steps (gazetted officers: leave application, apply leave, leave CTC, joining report, joining CTC, AG payslip; others: application, check leave account, office proceedings, SPARK, attendance, SB update, joining report), due the day they are back. Days are the calendar days from–to unless given (to leave out holidays). For EOL, moveDates also moves their next increment and Probation declaration task by its days. Casual and compensation leave aren't kept in WorkDesk." +
      ASK,
    input: z.object({
      employee: z.string().describe("Name, PEN or id"),
      leave: z.string().describe('Leave type: short name or name, e.g. "HPL", "Earned leave", "EOL"'),
      from: day,
      to: day,
      days: z.number().min(0.5).max(9999).optional().describe("Leave out to count every day from–to"),
      orderNo: z.string().max(100).optional(),
      notes: z.string().max(2000).optional(),
      stepsDone: z.array(z.string()).max(10).optional().describe("Steps already done, by name"),
      moveDates: z.boolean().optional().describe("For EOL: also move the next increment and the probation task (default yes)"),
    }),
    run: safely(async (ctx, a) => {
      const [staff, types] = await Promise.all([ctx.api<StaffList>("/staff"), typesOf(ctx)]);
      const e = findEmployee(staff, String(a.employee), false);
      const t = findType(types, String(a.leave));
      const steps = leaveSteps(e.gazetted);
      const doneSteps = ((a.stepsDone as string[]) ?? []).map((s) => {
        const q = lower(s);
        const found = steps.filter((x) => x.id === s || lower(x.text) === q || lower(x.text).includes(q));
        if (found.length !== 1) throw new Unclear(`The steps are: ${steps.map((x) => x.text).join("; ")}. "${s}" ${found.length ? "fits more than one" : "isn't one of them"}.`);
        return found[0]!.id;
      });
      const days = (a.days as number | undefined) ?? calendarDays(String(a.from), String(a.to));
      const move = a.moveDates !== false;
      const r = await ctx.send<{ id: string; taskId: string; postponed: LeavePostponed }>("POST", "/leave/leaves", {
        employeeId: e.id,
        typeId: t.id,
        fromDate: a.from,
        toDate: a.to,
        days,
        orderNo: a.orderNo ?? "",
        notes: a.notes ?? "",
        doneSteps,
        postpone: { increment: move, probation: move },
      });
      return {
        data: clean({
          done: `${t.name} marked for ${e.name}: ${formatDays(days)} days, ${a.from} to ${a.to}`,
          leaveTaskId: r.taskId,
          nextIncrementMovedTo: r.postponed.increment?.to,
          probationTaskMovedTo: r.postponed.probation?.to,
        }),
        touched: [
          { kind: "employee", id: e.id, title: e.name },
          { kind: "task", id: r.taskId, title: `Leave: ${e.name}` },
        ],
      };
    }),
  },
];
