// Leave page (user request 2026-10-31, "move leave to a standalone page from employee"; user's answers: the history
// of leaves in date order with their status, and a one-line summary on the employee's page). Every leave marked,
// newest first under month headings, each with its state (On leave, Upcoming, Due back, Rejoined, Cancelled) and its
// paperwork steps; filters by employee, state and leave type. With an employee chosen (?employee=…, as the
// employee page's summary line opens it) their leave account card (balances, entries, Mark leave, Entry) comes first.
// From 768px the leaves are a ruled table like a spreadsheet (user request 2026-11-26, "instead of this use a
// spreadsheet type approach"; LeaveTable), one row per leave with its own columns, the page the wider width; phones
// keep the list under month headings. On computers Mark leave adds a new row at the top of the table to type the
// leave straight into (user request 2026-11-26; NewLeaveRow), with the pop-up's checks under it; phones keep the pop-up.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarPlus, Check, ExternalLink, Hourglass, X } from "lucide-react";
import type { EmployeeLeave, LeaveType, StaffList, Task } from "../../shared/types";
import { calendarDays, daysWord, formatDays, leaveEnd, leaveShort, leaveWarnings, postponeDays, prefixDates, shiftDate, spellDays, suffixDates } from "../../shared/leave";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAllLeaves, useEmployeeLeaves, useLeaveAccount, useLeaveActions, useLeaveTypes, useStaff } from "../api";
import { LeaveCard, LeaveRow, STEP_TONE, lastStep, leaveState, stepWord } from "../components/LeaveAccount";
import { LeaveDialog, spanText, takesFrom, useHolidaysAround, type LeaveFormState } from "../components/LeaveDialog";
import { showUndo } from "../components/SwipeRow";
import { RefreshButton } from "../components/RefreshButton";
import { TaskDetails } from "../components/TaskDetails";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { Badge, Button, Card, ErrorNote, Fab, PageHeader, Segmented, SkeletonList, TONE, cx, inputClass } from "../components/ui";

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
  // The new row in the table (computers, 768px and wider); the pop-up on narrower screens.
  const [adding, setAdding] = useState(false);
  const markLeave = () => (window.matchMedia("(min-width: 768px)").matches ? setAdding(true) : setForm(employeeId ? { employeeId } : {}));
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
            <Button variant="primary" onClick={markLeave} className="max-sm:hidden" disabled={!types?.length || adding}>
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
        ) : list.length === 0 && !adding ? (
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
              adding={adding ? { employeeId } : null}
              onAdded={() => setAdding(false)}
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
  adding,
  onAdded,
}: {
  leaves: EmployeeLeave[];
  staff: StaffList;
  types: LeaveType[];
  today: string;
  onOpen: (l: EmployeeLeave) => void;
  onTask: (t: Task) => void;
  // The new row at the top (Mark leave), with the employee chosen in the filter, if any.
  adding: { employeeId: string } | null;
  onAdded: () => void;
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
            <th scope="col" className={head}>Prefix</th>
            <th scope="col" className={head}>From</th>
            <th scope="col" className={head}>To</th>
            <th scope="col" className={head}>Suffix</th>
            <th scope="col" className={cx(head, "text-right")}>Days</th>
            <th scope="col" className={head}>State</th>
            <th scope="col" className={head}>Order</th>
            <th scope="col" className={head}>Paperwork</th>
          </tr>
        </thead>
        <tbody>
          {adding && <NewLeaveRow staff={staff} types={types} today={today} employeeId={adding.employeeId} cell={cell} onDone={onAdded} />}
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
                  {/* Designation and PEN (user request 2026-11-26). */}
                  {(post(e?.designationId ?? null) || e?.pen) && (
                    <span className="block text-caption text-slate-500 [overflow-wrap:anywhere]">{[post(e?.designationId ?? null), e?.pen && `PEN ${e.pen}`].filter(Boolean).join(" · ")}</span>
                  )}
                </td>
                <td className={cell} title={t?.name}>
                  <span className={cx("block font-medium", cancelled ? "text-slate-400" : "text-ink")}>{t ? leaveShort(t) : "Leave"}</span>
                  {l.onMedical && <span className="block text-caption text-slate-500">Medical certificate</span>}
                </td>
                <AroundCell cell={cell} span={prefixDates(l)} days={l.prefixDays} />
                <td className={cx(cell, "whitespace-nowrap tabular-nums")}>{dayLabel(l.fromDate)}</td>
                <td className={cx(cell, "whitespace-nowrap tabular-nums")}>
                  {dayLabel(leaveEnd(l))}
                  {leaveEnd(l) !== l.toDate && <span className="block text-caption text-slate-500">was {dayLabel(l.toDate)}</span>}
                </td>
                <AroundCell cell={cell} span={suffixDates(l)} days={l.suffixDays} />
                <td className={cx(cell, "text-right tabular-nums")}>{formatDays(l.days)}</td>
                <td className={cell}>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {/* The rejoining date (the Back on column went, 2026-11-26). */}
                  {!cancelled && l.rejoinedOn && <span className="mt-0.5 block text-caption whitespace-nowrap text-slate-500 tabular-nums">{dayLabel(l.rejoinedOn)}</span>}
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
                <td className={cx(cell, "min-w-32")}>
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

// A prefix or suffix cell: its days and dates, or a dash.
function AroundCell({ cell, span, days }: { cell: string; span: { first: string; last: string } | null; days: number }) {
  return (
    <td className={cx(cell, "tabular-nums")}>
      {span ? (
        <>
          <span className="block font-medium text-ink">{daysWord(days)}</span>
          <span className="block text-caption text-slate-500">{spanText(span.first, span.last)}</span>
        </>
      ) : (
        <span className="text-slate-300">—</span>
      )}
    </td>
  );
}

// A new leave typed straight into the table (user request 2026-11-26, "when clicking Mark leave, create a new row in
// desktop mode and enter into it directly"): employee (focused), leave with its medical certificate tick, from, to,
// days (following the dates until typed), back on, order number and date, Save / Cancel; Enter saves, Esc cancels.
// Under it, once someone is chosen, the pop-up's checks: the balance before and after, the type's limit in the whole
// service, the KSR warnings (never blocking), and for a leave that doesn't count for increment (EOL) the increment and
// probation moves, ticked to start. Saved through Mark leave's own request, so the account line, the task with its
// steps and History are the same; steps already done and notes are added afterwards (the task's steps, the leave).
const NEW_FORM = "new-leave-row";
function NewLeaveRow({ staff, types, today, employeeId: preset, cell, onDone }: { staff: StaffList; types: LeaveType[]; today: string; employeeId: string; cell: string; onDone: () => void }) {
  const { markLeave, undoPostpone } = useLeaveActions();
  const offered = types.filter((t) => t.active);
  const people = staff.employees.filter((e) => e.permanent && !e.leftOn);
  const [employeeId, setEmployeeId] = useState(people.some((e) => e.id === preset) ? preset : "");
  const [typeId, setTypeId] = useState(offered[0]?.id ?? "");
  const [onMedical, setOnMedical] = useState(!!offered[0]?.medical);
  const [fromDate, setFrom] = useState(today);
  const [toDate, setTo] = useState(today);
  const [days, setDays] = useState("1");
  const [daysByHand, setDaysByHand] = useState(false);
  const [orderNo, setOrderNo] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [moveIncrement, setMoveIncrement] = useState(true);
  const [moveProbation, setMoveProbation] = useState(true);
  const [prefixTyped, setPrefix] = useState<string | null>(null);
  const [suffixTyped, setSuffix] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const second = useRef<HTMLSelectElement>(null);
  // Straight into the row: the employee, or the leave when the filter already chose them.
  useEffect(() => (employeeId ? second : first).current?.focus(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const account = useLeaveAccount(employeeId).data;
  const theirLeaves = useEmployeeLeaves(employeeId).data?.leaves ?? [];

  const employee = staff.employees.find((e) => e.id === employeeId);
  const type = types.find((t) => t.id === typeId);
  const setDates = (from: string, to: string) => {
    setFrom(from);
    setTo(to);
    if (!daysByHand && from && to >= from) setDays(String(calendarDays(from, to)));
  };
  const n = Number(days);
  const okDays = days.trim() !== "" && n >= 0.5 && Number.isInteger(n * 2);
  // Prefix / suffix: the holidays found just before and after the dates, until typed (user request 2026-11-26).
  const around = useHolidaysAround(employee, type, fromDate, toDate);
  const prefix = prefixTyped ?? String(around?.prefix.length ?? 0);
  const suffix = suffixTyped ?? String(around?.suffix.length ?? 0);
  const okAround = [prefix, suffix].every((x) => /^\d{1,2}$/.test(x.trim()) && Number(x) <= 31);
  const ok = !!employeeId && !!typeId && okDays && okAround && !!fromDate && toDate >= fromDate;

  // The pop-up's checks (LeaveDialog), for a new leave.
  const from = takesFrom(type);
  const source = from && types.find((t) => t.id === from.typeId);
  const now = (from && account?.balances.find((b) => b.typeId === from.typeId)?.balance) ?? 0;
  const after = from && okDays ? now - n * from.perDay : null;
  const short = after != null && after < 0 && !type?.mayGoNegative;
  const usedAfter = ((type && account?.used.find((u) => u.typeId === type.id)?.days) ?? 0) + (okDays ? n : 0);
  const pastLimit = type?.serviceLimit != null && usedAfter > type.serviceLimit;
  const spellTypes = new Set(types.filter((t) => t.spellLimit != null).map((t) => t.id));
  const warnings =
    type && okDays && fromDate && toDate >= fromDate
      ? leaveWarnings({
          type,
          days: n,
          onMedical,
          usedNonMedical: account?.used.find((u) => u.typeId === type.id)?.nonMedical ?? 0,
          spell: type.spellLimit != null ? spellDays(theirLeaves, fromDate, toDate, n, spellTypes) : n,
          atCredit: types.filter((t) => t.hasAccount).map((t) => ({ short: leaveShort(t), balance: account?.balances.find((b) => b.typeId === t.id)?.balance ?? 0 })),
        })
      : [];
  const moveBy = okDays ? postponeDays(n) : 0;
  const delays = !!type?.delaysIncrement && !onMedical;
  const offerIncrement = delays && !!employee?.nextIncrementOn;
  const offerProbation = delays && !!employee && !employee.probationDeclared && !employee.probationDeclaredOn;

  const groups = [
    ...staff.designations.map((d) => ({ label: d.name, list: people.filter((e) => e.designationId === d.id) })),
    { label: "No designation", list: people.filter((e) => !e.designationId || !staff.designations.some((d) => d.id === e.designationId)) },
  ].filter((g) => g.list.length);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!ok || markLeave.isPending) return;
    try {
      const postpone = { increment: offerIncrement && moveIncrement, probation: offerProbation && moveProbation };
      const r = await markLeave.mutateAsync({ employeeId, typeId, fromDate, toDate, days: n, onMedical, prefixDays: Number(prefix), suffixDays: Number(suffix), orderNo, orderDate: orderDate || null, notes: "", doneSteps: [], postpone });
      const moved = [r.postponed.increment && `next increment to ${dayLabel(r.postponed.increment.to)}`, r.postponed.probation && `probation task to ${dayLabel(r.postponed.probation.to)}`].filter(Boolean);
      showUndo(moved.length ? { message: `Leave marked; ${moved.join(", ")}`, onUndo: () => undoPostpone.mutate({ id: r.id, ...r.postponed }) } : { message: `Leave marked for ${employee?.name ?? "the employee"}` });
      onDone();
    } catch {
      // shown under the row
    }
  };
  const esc = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      onDone();
    }
  };
  // Compact, spreadsheet-sized fields (the form boxes elsewhere are taller); touch screens still get 16px text from
  // the base CSS so iPhone doesn't zoom.
  const field = "block h-8 w-full min-w-0 rounded-md border border-line bg-white px-1 text-footnote text-ink hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none";
  // Date boxes a fixed, narrower width (their own width was 155px, pushing the table past 1366px screens).
  const dateField = field.replace("w-full", "w-[7.75rem]");
  const checks = !!employee && (source || type?.serviceLimit != null || warnings.length > 0 || ((offerIncrement || offerProbation) && moveBy > 0));
  return (
    <>
      <tr className="bg-tint/40" onKeyDown={esc}>
        <td className={cx(cell, "text-right align-middle text-caption font-semibold text-brand-700")}>
          New
          {/* The form the row's fields belong to (a form can't sit inside a table row): Enter in a field saves. */}
          <form id={NEW_FORM} onSubmit={(e) => void submit(e)} className="hidden" />
        </td>
        <td className={cell}>
          <select ref={first} form={NEW_FORM} className={field} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required aria-label="Employee">
            <option value="">Choose…</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.list.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </td>
        <td className={cell}>
          <select
            ref={second}
            form={NEW_FORM}
            className={field}
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              setOnMedical(!!types.find((t) => t.id === e.target.value)?.medical);
            }}
            required
            aria-label="Leave"
          >
            {offered.map((t) => (
              <option key={t.id} value={t.id} title={t.name}>
                {leaveShort(t)}
              </option>
            ))}
          </select>
          <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-caption text-slate-600">
            <input type="checkbox" form={NEW_FORM} className="size-3.5 accent-brand-700" checked={onMedical} onChange={(e) => setOnMedical(e.target.checked)} />
            Medical certificate
          </label>
        </td>
        <td className={cell}>
          <input
            type="number"
            form={NEW_FORM}
            inputMode="numeric"
            min={0}
            max={31}
            step={1}
            className={cx(field.replace("w-full", "w-12"), "text-right")}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            aria-label="Prefix days"
            title="Holidays just before the first day (filled in from the holidays; change it as needed)"
          />
          {Number(prefix) > 0 && fromDate && toDate >= fromDate && <span className="mt-1 block text-caption text-slate-500 tabular-nums">{spanText(shiftDate(fromDate, -Number(prefix)), shiftDate(fromDate, -1))}</span>}
        </td>
        <td className={cell}>
          <input type="date" form={NEW_FORM} required className={dateField} value={fromDate} onChange={(e) => setDates(e.target.value, toDate < e.target.value ? e.target.value : toDate)} aria-label="From" />
        </td>
        <td className={cell}>
          <input type="date" form={NEW_FORM} required min={fromDate} className={dateField} value={toDate} onChange={(e) => setDates(fromDate, e.target.value)} aria-label="To" />
        </td>
        <td className={cell}>
          <input
            type="number"
            form={NEW_FORM}
            inputMode="numeric"
            min={0}
            max={31}
            step={1}
            className={cx(field.replace("w-full", "w-12"), "text-right")}
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            aria-label="Suffix days"
            title="Holidays just after the last day (filled in from the holidays; change it as needed)"
          />
          {Number(suffix) > 0 && fromDate && toDate >= fromDate && <span className="mt-1 block text-caption text-slate-500 tabular-nums">{spanText(shiftDate(toDate, 1), shiftDate(toDate, Number(suffix)))}</span>}
        </td>
        <td className={cell}>
          <input
            type="number"
            form={NEW_FORM}
            inputMode="decimal"
            required
            min={0.5}
            step={0.5}
            className={cx(field.replace("w-full", "w-14"), "text-right")}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setDaysByHand(true);
            }}
            aria-label="Days"
            title={fromDate && toDate >= fromDate ? `${daysWord(calendarDays(fromDate, toDate))} from the first day to the last; change it to leave out holidays` : undefined}
          />
        </td>
        <td className={cx(cell, "align-middle")}>
          <Badge tone={fromDate > today ? "info" : "brand"}>{fromDate > today ? "Upcoming" : "On leave"}</Badge>
        </td>
        <td className={cell}>
          <input form={NEW_FORM} className={field} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} maxLength={100} placeholder="Order no." aria-label="Order number" />
          <input type="date" form={NEW_FORM} className={cx(dateField, "mt-1")} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} aria-label="Order date" />
        </td>
        <td className={cx(cell, "align-middle")}>
          <div className="flex flex-wrap gap-1.5">
            <Button type="submit" form={NEW_FORM} size="sm" variant="primary" disabled={!ok || markLeave.isPending}>
              <Check size={15} /> Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDone} aria-label="Cancel the new leave">
              <X size={15} />
            </Button>
          </div>
        </td>
      </tr>
      {(checks || markLeave.error) && (
        <tr className="bg-tint/40" onKeyDown={esc}>
          <td className={cell} />
          <td colSpan={10} className={cx(cell, "space-y-1 text-footnote", short || pastLimit || warnings.length ? "text-urgent-ink" : "text-slate-600")}>
            {employee && source && after != null && (
              <p>
                {leaveShort(source)} balance of {employee.name}: {formatDays(now)} → <span className="font-semibold">{formatDays(after)}</span>
                {from!.perDay !== 1 && ` (${formatDays(from!.perDay)} days of ${leaveShort(source)} for each day)`}
                {short && ". Not enough balance; it can still be saved if the leave is sanctioned."}
              </p>
            )}
            {employee && type?.serviceLimit != null && (
              <p>
                {leaveShort(type)} in the whole service: {formatDays(usedAfter)} of {formatDays(type.serviceLimit)} days{pastLimit && " — past the limit"}.
              </p>
            )}
            {warnings.map((w) => (
              <p key={w} className="[overflow-wrap:anywhere]">
                ⚠ {w}
              </p>
            ))}
            {warnings.length > 0 && !short && <p className="text-slate-600">It can still be saved if the leave is sanctioned.</p>}
            {(offerIncrement || offerProbation) && moveBy > 0 && (
              <div className="flex flex-wrap gap-x-4 text-slate-700">
                <span className="font-medium">{type!.name} doesn't count for increment or probation:</span>
                {offerIncrement && (
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" form={NEW_FORM} className="size-3.5 accent-brand-700" checked={moveIncrement} onChange={(e) => setMoveIncrement(e.target.checked)} />
                    Move the next increment by {daysWord(moveBy)} ({dayLabel(employee!.nextIncrementOn!)} → {dayLabel(shiftDate(employee!.nextIncrementOn!, moveBy))})
                  </label>
                )}
                {offerProbation && (
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" form={NEW_FORM} className="size-3.5 accent-brand-700" checked={moveProbation} onChange={(e) => setMoveProbation(e.target.checked)} />
                    Move the Probation declaration task by {daysWord(moveBy)}
                  </label>
                )}
              </div>
            )}
            <ErrorNote error={markLeave.error} />
          </td>
        </tr>
      )}
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
