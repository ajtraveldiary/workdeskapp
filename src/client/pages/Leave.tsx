// Leave page (user request 2026-10-31, "move leave to a standalone page from employee"; user's answers: the history
// of leaves in date order with their status, and a one-line summary on the employee's page). Every leave marked,
// newest first under month headings, each with its state (On leave, Upcoming, Due back, Rejoined, Cancelled) and its
// paperwork steps; filters by employee, state and leave type. With an employee chosen (?employee=…, as the
// employee page's summary line opens it) their leave account card (balances, entries, Mark leave, Entry) comes first.
// From 768px the leaves are a ruled table like a spreadsheet (user request 2026-11-26, "instead of this use a
// spreadsheet type approach"; LeaveTable), one row per leave with its own columns, the page the wider width; phones
// keep the list under month headings.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarPlus, Check, ExternalLink, Hourglass } from "lucide-react";
import type { EmployeeLeave, LeaveType, StaffList, Task } from "../../shared/types";
import { formatDays, leaveEnd, leaveShort, rejoinDay } from "../../shared/leave";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAllLeaves, useLeaveTypes, useStaff } from "../api";
import { LeaveCard, LeaveRow, STEP_TONE, lastStep, leaveState, stepWord } from "../components/LeaveAccount";
import { LeaveDialog, type LeaveFormState } from "../components/LeaveDialog";
import { RefreshButton } from "../components/RefreshButton";
import { TaskDetails } from "../components/TaskDetails";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { Badge, Button, Card, Fab, PageHeader, Segmented, SkeletonList, TONE, cx, inputClass } from "../components/ui";

const STATES = ["On leave", "Due back", "Upcoming", "Rejoined", "Cancelled"] as const;
type StateFilter = "all" | (typeof STATES)[number];
const monthOf = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function LeavePage() {
  const [params, setParams] = useSearchParams();
  const employeeId = params.get("employee") ?? "";
  const staff = useStaff().data;
  const types = useLeaveTypes().data?.types;
  const { data } = useAllLeaves();
  const [state, setState] = useState<StateFilter>("all");
  const [typeId, setTypeId] = useState("");
  const [form, setForm] = useState<LeaveFormState>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState<TaskDialogMode | null>(null);
  const today = data?.today ?? "";
  const employee = staff?.employees.find((e) => e.id === employeeId);
  const chooseEmployee = (id: string) => setParams(id ? { employee: id } : {}, { replace: true });

  const withState = useMemo(() => (data?.leaves ?? []).map((l) => ({ l, st: leaveState(l, today) })), [data, today]);
  const forPerson = withState.filter((x) => !employeeId || x.l.employeeId === employeeId).filter((x) => !typeId || x.l.typeId === typeId);
  const count = (s: StateFilter) => (s === "all" ? forPerson.length : forPerson.filter((x) => x.st.label === s).length);
  const list = forPerson.filter((x) => state === "all" || x.st.label === state);
  // Newest first (by the day the leave starts), under month headings.
  const months: { month: string; items: EmployeeLeave[] }[] = [];
  for (const { l } of list) {
    const m = monthOf(l.fromDate);
    const last = months[months.length - 1];
    if (last?.month === m) last.items.push(l);
    else months.push({ month: m, items: [l] });
  }
  const name = (id: string) => staff?.employees.find((e) => e.id === id)?.name ?? "Employee";

  return (
    <>
      <PageHeader
        title="Leave"
        subtitle="Every leave marked, newest first, with where it stands; choose an employee for their leave account."
        actions={
          <>
            <RefreshButton keys={[["leave"]]} label="Refresh leave" />
            <Button variant="primary" onClick={() => setForm(employeeId ? { employeeId } : {})} className="max-sm:hidden" disabled={!types?.length}>
              <CalendarPlus size={17} /> Mark leave
            </Button>
          </>
        }
      />
      <Fab label="Mark leave" onClick={() => setForm(employeeId ? { employeeId } : {})} />
      <div className="mb-3 grid gap-2 min-[480px]:grid-cols-2">
        <select className={inputClass} value={employeeId} onChange={(e) => chooseEmployee(e.target.value)} aria-label="Employee">
          <option value="">Everyone</option>
          {staff && <PeopleOptions staff={staff} leaves={data?.leaves ?? []} />}
        </select>
        <select className={inputClass} value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Leave type">
          <option value="">All leave types</option>
          {(types ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.short && t.short !== t.name ? ` (${t.short})` : ""}
            </option>
          ))}
        </select>
      </div>
      {employee && (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="min-w-0 flex-1 font-semibold text-ink [overflow-wrap:anywhere]">{employee.name}</h2>
            <Link to={`/employees/${employee.id}`} className="inline-flex items-center gap-1 text-footnote font-medium text-brand-700 hover:underline">
              <ExternalLink size={13} /> Employee's page
            </Link>
          </div>
          {employee.permanent ? (
            <LeaveCard employee={employee} today={today} hideLeaves />
          ) : (
            <p className="text-sm text-slate-500">Leave accounts are kept for permanent staff.</p>
          )}
        </div>
      )}
      <div className="mb-3">
        <Segmented<StateFilter>
          value={state}
          onChange={setState}
          options={[{ value: "all", label: "All", count: count("all") }, ...STATES.map((s) => ({ value: s, label: s, count: count(s) }))]}
        />
      </div>
      <Card className="overflow-hidden">
        {!data || !staff || !types ? (
          <SkeletonList rows={5} />
        ) : list.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500 sm:px-5">
            {data.leaves.length === 0 ? "No leave marked yet. Mark leave adds one, with its paperwork as a task." : "No leave matches these filters."}
          </p>
        ) : (
          <>
            <LeaveTable
              leaves={list.map((x) => x.l)}
              staff={staff}
              types={types}
              today={today}
              onOpen={(l) => setForm({ leave: l })}
              onTask={setTask}
            />
            <div className="md:hidden">
              {months.map((m) => (
            <section key={m.month}>
              <h3 className="border-b border-line bg-slate-50 px-4 py-1.5 text-caption font-semibold text-slate-500 sm:px-5">{m.month}</h3>
              <ul className="divide-y divide-line border-b border-line last:border-b-0">
                {m.items.map((l) => (
                  <LeaveRow
                    key={l.id}
                    leave={l}
                    who={employeeId ? undefined : name(l.employeeId)}
                    type={types.find((t) => t.id === l.typeId)}
                    today={today}
                    onOpen={() => setForm({ leave: l })}
                    onTask={setTask}
                  />
                ))}
              </ul>
            </section>
              ))}
            </div>
          </>
        )}
      </Card>
      {types && types.length > 0 && data && <p className="mt-2 text-footnote text-slate-500">{summaryLine(forPerson.map((x) => x.l), types)}</p>}
      <LeaveDialog state={form} onClose={() => setForm(null)} />
      <TaskDetails
        task={task}
        onClose={() => setTask(null)}
        onEdit={(t) => {
          setTask(null);
          setTaskForm({ kind: "edit", task: t });
        }}
      />
      <TaskDialog mode={taskForm} onClose={() => setTaskForm(null)} />
    </>
  );
}

// The leaves as a ruled table, like a spreadsheet (computers and tablets, 768px and wider): Sl, employee with their
// designation, leave (with "Medical certificate"), from, to, days, back on (or rejoined), state, order, and the
// paperwork: the step of its task updated last, which opens the task's steps, with "n/m steps". Tapping a row opens
// the leave to edit. It scrolls sideways inside its card when the window is narrow.
function LeaveTable({
  leaves,
  staff,
  types,
  today,
  onOpen,
  onTask,
}: {
  leaves: EmployeeLeave[];
  staff: StaffList;
  types: LeaveType[];
  today: string;
  onOpen: (l: EmployeeLeave) => void;
  onTask: (t: Task) => void;
}) {
  const person = (id: string) => staff.employees.find((e) => e.id === id);
  const post = (id: string | null) => (id ? staff.designations.find((d) => d.id === id)?.name : undefined);
  const head = "border border-line bg-canvas-soft px-2 py-2 text-left text-caption font-semibold whitespace-nowrap text-slate-600";
  const cell = "border border-line px-2 py-2 align-top";
  return (
    <div className="overflow-x-auto max-md:hidden">
      <table className="w-full min-w-[52rem] border-collapse text-footnote">
        <thead>
          <tr>
            <th scope="col" className={cx(head, "w-10 text-right")}>Sl</th>
            <th scope="col" className={head}>Employee</th>
            <th scope="col" className={head}>Leave</th>
            <th scope="col" className={head}>From</th>
            <th scope="col" className={head}>To</th>
            <th scope="col" className={cx(head, "text-right")}>Days</th>
            <th scope="col" className={head}>Back on</th>
            <th scope="col" className={head}>State</th>
            <th scope="col" className={head}>Order</th>
            <th scope="col" className={head}>Paperwork</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((l, i) => {
            const e = person(l.employeeId);
            const t = types.find((x) => x.id === l.typeId);
            const st = leaveState(l, today);
            const items = l.task?.checklist ?? [];
            const step = lastStep(items);
            const done = items.filter((x) => x.done).length;
            const cancelled = l.status === "cancelled";
            return (
              <tr key={l.id} className={cx("row-click text-slate-700 transition-colors has-[.row-link:hover]:bg-slate-50/80", cancelled && "text-slate-400")}>
                <td className={cx(cell, "text-right text-slate-500 tabular-nums")}>{i + 1}</td>
                <td className={cx(cell, "min-w-32")}>
                  <button type="button" onClick={() => onOpen(l)} className="row-link group/title text-left" aria-label={`Open ${e?.name ?? "employee"}'s ${t?.name ?? "leave"}, ${dayLabel(l.fromDate)} to ${dayLabel(leaveEnd(l))}`}>
                    <span className={cx("block font-medium [overflow-wrap:anywhere] group-hover/title:text-brand-700", cancelled ? "text-slate-400" : "text-ink")}>{e?.name ?? "Employee"}</span>
                  </button>
                  {post(e?.designationId ?? null) && <span className="block text-caption text-slate-500 [overflow-wrap:anywhere]">{post(e?.designationId ?? null)}</span>}
                </td>
                <td className={cell} title={t?.name}>
                  <span className={cx("block font-medium", cancelled ? "text-slate-400" : "text-ink")}>{t ? leaveShort(t) : "Leave"}</span>
                  {l.onMedical && <span className="block text-caption text-slate-500">Medical certificate</span>}
                </td>
                <td className={cx(cell, "whitespace-nowrap tabular-nums")}>{dayLabel(l.fromDate)}</td>
                <td className={cx(cell, "whitespace-nowrap tabular-nums")}>
                  {dayLabel(leaveEnd(l))}
                  {leaveEnd(l) !== l.toDate && <span className="block text-caption text-slate-500">was {dayLabel(l.toDate)}</span>}
                </td>
                <td className={cx(cell, "text-right tabular-nums")}>{formatDays(l.days)}</td>
                <td className={cx(cell, "whitespace-nowrap tabular-nums")}>
                  {cancelled ? (
                    <span className="text-slate-300">—</span>
                  ) : l.rejoinedOn ? (
                    <>
                      <span className="block text-caption text-slate-500">Rejoined</span>
                      {dayLabel(l.rejoinedOn)}
                    </>
                  ) : (
                    dayLabel(rejoinDay(l))
                  )}
                </td>
                <td className={cell}>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
                <td className={cx(cell, "[overflow-wrap:anywhere]")}>
                  {l.orderNo || l.orderDate ? (
                    <>
                      {l.orderNo && <span className="block">{l.orderNo}</span>}
                      {l.orderDate && <span className="block text-caption whitespace-nowrap text-slate-500 tabular-nums">{dayLabel(l.orderDate)}</span>}
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className={cx(cell, "min-w-36")}>
                  {cancelled || !l.task ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onTask(l.task!)}
                        aria-label={step ? `Last updated step: ${step.text}, ${stepWord(step)}. Show steps` : "No step done yet. Show steps"}
                        className={cx(
                          "relative z-10 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-xs font-medium enabled:hover:brightness-95 active:scale-[0.97]",
                          TONE[step ? STEP_TONE(step) : "neutral"].soft,
                        )}
                      >
                        {step?.done ? <Check size={12} className="shrink-0" aria-hidden /> : step?.waiting ? <Hourglass size={12} className="shrink-0" aria-hidden /> : null}
                        <span className="line-clamp-2 [overflow-wrap:anywhere]">{step ? (step.done ? step.text : `${step.text}: ${stepWord(step)}`) : "No step done yet"}</span>
                      </button>
                      <span className="block text-caption text-slate-500 tabular-nums">
                        {done}/{items.length} steps
                      </span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Permanent staff in the office, then anyone else with leave marked (left the office, temporary), by name.
function PeopleOptions({ staff, leaves }: { staff: StaffList; leaves: EmployeeLeave[] }) {
  const withLeave = new Set(leaves.map((l) => l.employeeId));
  const here = staff.employees.filter((e) => e.permanent && !e.leftOn).sort((a, b) => a.name.localeCompare(b.name));
  const others = staff.employees.filter((e) => !(e.permanent && !e.leftOn) && withLeave.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {here.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
      {others.length > 0 && (
        <optgroup label="Left the office / temporary">
          {others.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

// Days of each type in the list (cancelled leave left out): "EL 40 days · HPL 12 days".
function summaryLine(leaves: EmployeeLeave[], types: { id: string; name: string; short: string }[]) {
  const days = new Map<string, number>();
  for (const l of leaves) if (l.status === "active") days.set(l.typeId, (days.get(l.typeId) ?? 0) + l.days);
  const parts = types.filter((t) => days.has(t.id)).map((t) => `${leaveShort(t)} ${days.get(t.id)} day${days.get(t.id) === 1 ? "" : "s"}`);
  return parts.length ? `Leave taken in this list: ${parts.join(" · ")}` : "";
}
