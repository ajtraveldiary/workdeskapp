// Leave page (user request 2026-10-31, "move leave to a standalone page from employee"; user's answers: the history
// of leaves in date order with their status, and a one-line summary on the employee's page). Every leave marked,
// newest first under month headings, each with its state (On leave, Upcoming, Due back, Rejoined, Cancelled) and its
// paperwork steps; filters by employee, state and leave type. With an employee chosen (?employee=…, as the
// employee page's summary line opens it) their leave account card (balances, entries, Mark leave, Entry) comes first.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarPlus, ExternalLink } from "lucide-react";
import type { EmployeeLeave, StaffList, Task } from "../../shared/types";
import { leaveShort } from "../../shared/leave";
import { useAllLeaves, useLeaveTypes, useStaff } from "../api";
import { LeaveCard, LeaveRow, leaveState } from "../components/LeaveAccount";
import { LeaveDialog, type LeaveFormState } from "../components/LeaveDialog";
import { RefreshButton } from "../components/RefreshButton";
import { TaskDetails } from "../components/TaskDetails";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { Button, Card, Fab, PageHeader, Segmented, SkeletonList, inputClass } from "../components/ui";

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
          months.map((m) => (
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
          ))
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
