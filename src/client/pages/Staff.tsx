// Employees page (user request 2026-10-07; called Staff until renamed by user request the same day): the office's
// employees, permanent or temporary, and designations. Tasks and reminders can be
// about an employee, a designation or the general office (Related.tsx). Reached from the side rail on wider
// screens and from the profile menu on phones. Only WorkDesk's database changes; History records each change.
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Hourglass,
  ListPlus,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Search,
  Trash2,
  TrendingUp,
  UserMinus,
  UserPlus,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { Employee, StaffList, Task } from "../../shared/types";
import { EMPLOYEE_CATEGORIES, ENGAGEMENTS, type Engagement, ENGAGEMENT_LABELS, contractEnd, incrementDue, incrementOverdue } from "../../shared/staff";
import type { EmployeeInput } from "../../shared/schemas";
import { useEmployeeWork, useIncrementDone, useMe, useRetiring, useStaff, useStaffActions } from "../api";
import { ChecklistChip } from "../components/Checklist";
import { showUndo } from "../components/SwipeRow";
import { formatDay, formatTime } from "../format";
import { Avatar } from "../components/Avatar";
import { RefreshButton } from "../components/RefreshButton";
import { TaskDetails } from "../components/TaskDetails";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { Badge, Button, Card, ErrorNote, Fab, Field, Loading, Modal, PageHeader, Segmented, SkeletonList, cx, inputClass } from "../components/ui";

const fullDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
// Whole years from a to b (both YYYY-MM-DD).
function yearsBetween(a: string, b: string) {
  let y = Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  if (b.slice(5) < a.slice(5)) y--;
  return y;
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function StaffPage() {
  const { data, error } = useStaff();
  const navigate = useNavigate();
  const [form, setForm] = useState<{ employee: Employee | null } | null>(null);
  // ?employee=<id> (Home's increment rows) opens that employee's card.
  const [params, setParams] = useSearchParams();
  const [openId, setOpenIdState] = useState<string | null>(params.get("employee"));
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    if (!id && params.has("employee")) setParams({}, { replace: true });
  };

  const add = () => setForm({ employee: null });
  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="The office's employees, permanent and temporary. Designations are in Settings. Link tasks and reminders to them with the person icon in the task and reminder forms."
        actions={
          <>
            <RefreshButton keys={[["staff"], ["staff-work"]]} label="Refresh employees" />
            <Button variant="primary" onClick={add} className="max-sm:hidden">
              <UserPlus size={17} /> Add employee
            </Button>
          </>
        }
      />
      <Fab label="Add employee" onClick={add} />
      {error ? (
        <p className="text-urgent-ink">{error.message}</p>
      ) : !data ? (
        <SkeletonList rows={6} />
      ) : (
        <div className="space-y-4">
          {/* Designations are edited in Settings > Employees (moved there by user request 2026-10-07). */}
          <DueIncrements staff={data} onOpen={setOpenId} />
          <RetiringSoon onOpen={setOpenId} />
          <Employees staff={data} onOpen={setOpenId} onAdd={add} onDesignations={() => navigate("/settings#employees")} />
        </div>
      )}
      {data && (
        <>
          <EmployeeDialog key={form?.employee?.id ?? "new"} open={form !== null} employee={form?.employee ?? null} staff={data} onClose={() => setForm(null)} />
          <EmployeeDetails
            employee={data.employees.find((e) => e.id === openId) ?? null}
            staff={data}
            onClose={() => setOpenId(null)}
            onEdit={(e) => {
              setOpenId(null);
              setForm({ employee: e });
            }}
          />
        </>
      )}
    </>
  );
}

// --- Increments due (user request 2026-10-07) ---
// Employees whose next increment falls this month or earlier: Mark done moves the date a year on (with Undo).
// Home's Due Today shows the same ones from the 20th of the month.
function DueIncrements({ staff, onOpen }: { staff: StaffList; onOpen: (id: string) => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const done = useIncrementDone();
  const desig = new Map(staff.designations.map((d) => [d.id, d.name]));
  const due = staff.employees
    .filter((e) => !e.leftOn && e.permanent && incrementDue(e.nextIncrementOn, today))
    .sort((a, b) => a.nextIncrementOn!.localeCompare(b.nextIncrementOn!) || a.name.localeCompare(b.name));
  if (!due.length) return null;
  const markDone = (e: Employee) =>
    done.mutate(
      { id: e.id },
      {
        onSuccess: (r) =>
          showUndo({
            message: `Increment done: ${e.name}${r.next ? ` · next ${fullDate(r.next)}` : ""}`,
            onUndo: () => r.previous && done.mutate({ id: e.id, undoTo: r.previous }),
          }),
      },
    );
  return (
    <Card className="overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-footnote font-semibold text-slate-600 sm:px-5">
        <TrendingUp size={15} className="text-brand-700" />
        <span className="flex-1">Due increments</span>
        <span className="font-normal text-slate-500">{due.length}</span>
      </h2>
      <ul className="divide-y divide-line">
        {due.map((e) => {
          const late = incrementOverdue(e.nextIncrementOn, today);
          return (
            <li key={e.id} className="row-click flex items-center gap-3 px-4 py-2.5 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5">
              <button onClick={() => onOpen(e.id)} className="row-link group/title min-w-0 flex-1 text-left">
                <span className="line-clamp-2 text-subhead font-medium text-ink [overflow-wrap:anywhere] group-hover/title:text-brand-700">{e.name}</span>
                <span className="block text-footnote text-slate-500">
                  {[desig.get(e.designationId ?? ""), e.payScale].filter(Boolean).join(" · ")}
                  {desig.get(e.designationId ?? "") || e.payScale ? " · " : ""}
                  <span className={cx(late && "font-medium text-urgent-ink")}>
                    {late ? "Overdue · " : "Due "}
                    {fullDate(e.nextIncrementOn!)}
                  </span>
                </span>
              </button>
              <Button size="sm" onClick={() => markDone(e)} disabled={done.isPending} className="shrink-0">
                <Check size={15} /> Mark done
              </Button>
            </li>
          );
        })}
      </ul>
      <ErrorNote error={done.error} />
    </Card>
  );
}

// --- Retiring within 12 months (user request 2026-10-08; user's choices: a Pension papers task, and this list) ---
// Permanent employees still here who retire within a year, soonest first: the retirement date and how far
// away it is, and their Pension papers task (made 12 months before; its checklist progress, or "Papers sent"
// once completed). The name opens the employee's card; the progress opens the task.
function RetiringSoon({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error } = useRetiring();
  const [task, setTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState<TaskDialogMode | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data?.retiring.length) return null;
  const { today } = data;
  return (
    <Card className="overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-footnote font-semibold text-slate-600 sm:px-5">
        <Hourglass size={15} className="text-brand-700" />
        <span className="flex-1">Retiring within 12 months</span>
        <span className="font-normal text-slate-500">{data.retiring.length}</span>
      </h2>
      <ul className="divide-y divide-line">
        {data.retiring.map((r) => {
          const past = r.retiresOn < today;
          const done = r.task?.status === "done";
          return (
            <li key={r.employeeId} className="row-click flex items-center gap-3 px-4 py-2.5 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5">
              <button onClick={() => onOpen(r.employeeId)} className="row-link group/title min-w-0 flex-1 text-left">
                <span className="line-clamp-2 text-subhead font-medium text-ink [overflow-wrap:anywhere] group-hover/title:text-brand-700">{r.name}</span>
                <span className="block text-footnote text-slate-500">
                  {r.designation ? `${r.designation} · ` : ""}
                  <span className={cx(past && "font-medium text-urgent-ink")}>
                    {past ? "Retired on " : "Retires "}
                    {fullDate(r.retiresOn)}
                    {!past && ` · ${untilText(today, r.retiresOn)}`}
                  </span>
                </span>
              </button>
              {r.task &&
                (done ? (
                  <button
                    type="button"
                    onClick={() => setTask(r.task)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-white px-1.5 py-px text-footnote font-medium text-low-ink enabled:hover:bg-slate-50 active:scale-[0.97]"
                    aria-label={`Pension papers sent for ${r.name}. Show task`}
                  >
                    <Check size={12} /> Papers sent
                  </button>
                ) : (
                  <span className="shrink-0 text-footnote">
                    <ChecklistChip items={r.task.checklist} onClick={() => setTask(r.task)} />
                  </span>
                ))}
            </li>
          );
        })}
      </ul>
      <TaskDetails
        task={task}
        onClose={() => setTask(null)}
        onEdit={(t) => {
          setTask(null);
          setTaskForm({ kind: "edit", task: t });
        }}
      />
      <TaskDialog mode={taskForm} onClose={() => setTaskForm(null)} />
    </Card>
  );
}

// "in 8 months", "in 3 weeks", "in 5 days", "today".
function untilText(today: string, day: string) {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 14) return `in ${plural(days, "day")}`;
  if (days < 60) return `in ${plural(Math.round(days / 7), "week")}`;
  return `in ${plural(Math.round(days / 30.44), "month")}`;
}

// --- Employees ---

function Employees({ staff, onOpen, onAdd, onDesignations }: { staff: StaffList; onOpen: (id: string) => void; onAdd: () => void; onDesignations: () => void }) {
  const [q, setQ] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  // All / Permanent / Temporary (user request 2026-10-07).
  const [kind, setKind] = useState<"all" | "permanent" | "temporary">("all");
  const { addCommon } = useStaffActions();
  const query = q.trim().toLowerCase();
  const desig = new Map(staff.designations.map((d) => [d.id, d.name]));
  const typeName = new Map(staff.types.map((t) => [t.id, t.name]));
  const match = (e: Employee) =>
    (kind === "all" || e.permanent === (kind === "permanent")) &&
    (!query || [e.name, e.pen, e.phone, e.email, desig.get(e.designationId ?? "") ?? "", typeName.get(e.typeId ?? "") ?? ""].some((x) => x.toLowerCase().includes(query)));
  const current = staff.employees.filter((e) => !e.leftOn);
  const temporary = current.filter((e) => !e.permanent).length;
  const here = staff.employees.filter((e) => !e.leftOn && match(e));
  const left = staff.employees.filter((e) => e.leftOn && match(e));
  // In designation order (senior first), then those without one.
  const groups = [...staff.designations.map((d) => ({ key: d.id, name: d.name, people: here.filter((e) => e.designationId === d.id) })), { key: "none", name: "No designation", people: here.filter((e) => !e.designationId || !desig.has(e.designationId)) }].filter((g) => g.people.length);

  if (staff.employees.length === 0)
    return (
      <Card className="flex flex-col items-center px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-info text-white">
          <UsersRound size={22} />
        </span>
        <p className="mt-3 font-medium text-ink">No employees yet</p>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          {staff.designations.length === 0
            ? "Start with the designations in your office, then add each employee. You can then link a task or reminder to an employee, to everyone of a designation, or to the general office."
            : "Add each employee of the office with their designation."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {staff.designations.length === 0 && (
            <Button onClick={() => addCommon.mutate(undefined, { onSuccess: onDesignations })} disabled={addCommon.isPending}>
              <ListPlus size={16} /> Add common designations
            </Button>
          )}
          <Button variant="primary" onClick={onAdd}>
            <UserPlus size={16} /> Add employee
          </Button>
        </div>
        <ErrorNote error={addCommon.error} />
      </Card>
    );

  return (
    <div className="space-y-4">
      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PEN, phone or designation" aria-label="Search employees" className={cx(inputClass, "pl-9")} />
      </label>
      <Segmented
        value={kind}
        onChange={setKind}
        oneRow
        options={[
          { value: "all", label: "All", count: current.length },
          { value: "permanent", label: "Permanent", count: current.length - temporary },
          { value: "temporary", label: "Temporary", count: temporary },
        ]}
      />
      {groups.length === 0 && left.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">{query ? `No one matches “${q.trim()}”.` : kind === "temporary" ? "No temporary employees." : "No permanent employees."}</p>
      )}
      {groups.map((g) => (
        <Card key={g.key} className="overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-footnote font-semibold text-slate-600 sm:px-5">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{g.name}</span>
            <span className="shrink-0 font-normal text-slate-500">{g.people.length}</span>
          </h2>
          <ul className="divide-y divide-line">
            {g.people.map((e) => (
              <EmployeeRow key={e.id} employee={e} type={typeName.get(e.typeId ?? "")} onOpen={() => onOpen(e.id)} />
            ))}
          </ul>
        </Card>
      ))}
      {left.length > 0 && (
        <Card className="overflow-hidden">
          <button onClick={() => setShowLeft((s) => !s)} aria-expanded={showLeft} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-footnote font-semibold text-slate-600 hover:bg-slate-50 sm:px-5">
            <span className="flex-1">Left the office</span>
            <span className="font-normal text-slate-500">{left.length}</span>
            <ChevronDown size={16} className={cx("transition", showLeft && "rotate-180")} />
          </button>
          {showLeft && (
            <ul className="divide-y divide-line border-t border-line">
              {left.map((e) => (
                <EmployeeRow key={e.id} employee={e} designation={desig.get(e.designationId ?? "")} type={typeName.get(e.typeId ?? "")} onOpen={() => onOpen(e.id)} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function EmployeeRow({ employee: e, designation, type, onOpen }: { employee: Employee; designation?: string; type?: string; onOpen: () => void }) {
  // Temporary ones show how they are engaged and their type (HMC, NHM…) instead of the PEN.
  const line = [designation, ...(e.permanent ? [e.pen && `PEN ${e.pen}`] : [ENGAGEMENT_LABELS[e.engagement as Engagement], type]), e.phone].filter(Boolean).join(" · ");
  return (
    <li className="row-click flex items-center gap-3 px-4 py-2.5 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5">
      <Avatar name={e.name} size={36} />
      <button onClick={onOpen} className="row-link group/title min-w-0 flex-1 text-left">
        <span className="line-clamp-2 text-subhead font-medium text-ink [overflow-wrap:anywhere] group-hover/title:text-brand-700">{e.name}</span>
        {line && <span className="block truncate text-footnote text-slate-500">{line}</span>}
      </button>
      {!e.permanent && <TemporaryTag />}
      {e.leftOn && <Badge>Left {fullDate(e.leftOn)}</Badge>}
    </li>
  );
}

function TemporaryTag({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full bg-high-soft px-2 py-0.5 text-caption font-medium text-high-ink", className)}>
      <Clock size={12} /> Temporary
    </span>
  );
}

// --- Employee details card ---

function EmployeeDetails({ employee, staff, onClose, onEdit }: { employee: Employee | null; staff: StaffList; onClose: () => void; onEdit: (e: Employee) => void }) {
  return (
    <Modal open={employee !== null} onClose={onClose} title="Employee" closeOnBackdrop>
      {employee && <Details key={employee.id} e={employee} staff={staff} onClose={onClose} onEdit={onEdit} />}
    </Modal>
  );
}

function Details({ e, staff, onClose, onEdit }: { e: Employee; staff: StaffList; onClose: () => void; onEdit: (e: Employee) => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { setLeft, removeEmployee } = useStaffActions();
  const work = useEmployeeWork(e.id);
  const [task, setTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState<TaskDialogMode | null>(null);
  const navigate = useNavigate();
  const designation = staff.designations.find((d) => d.id === e.designationId)?.name;
  const digits = e.phone.replace(/\D/g, "");
  const whatsapp = digits.length === 10 ? `91${digits}` : digits;
  const busy = setLeft.isPending || removeEmployee.isPending;

  const ended = !!e.engagedTill && e.engagedTill < today;
  const typeName = staff.types.find((t) => t.id === e.typeId)?.name;
  const rows: [string, ReactNode][] = e.permanent
    ? [
        ["Employment", "Permanent"],
        ["PEN", e.pen],
        ["Phone", e.phone],
        ["Email", e.email && <a href={`mailto:${e.email}`} className="text-brand-700 hover:underline">{e.email}</a>],
        ["Date of birth", e.dateOfBirth && `${fullDate(e.dateOfBirth)} (${yearsBetween(e.dateOfBirth, today)} years)`],
        ["Category", e.category],
        ["Joined service", e.joinedServiceOn && `${fullDate(e.joinedServiceOn)} (${plural(yearsBetween(e.joinedServiceOn, today), "year")} of service)`],
        ["Joined this office", e.joinedOfficeOn && fullDate(e.joinedOfficeOn)],
        ["Next increment", e.nextIncrementOn && <span className={cx(e.nextIncrementOn < today && "font-medium text-urgent-ink")}>{fullDate(e.nextIncrementOn)}{e.nextIncrementOn < today && " (passed)"}</span>],
        ["Retirement", e.retiresOn && `${fullDate(e.retiresOn)}${e.retiresOn > today ? ` (in ${yearsBetween(today, e.retiresOn) > 0 ? plural(yearsBetween(today, e.retiresOn), "year") : "less than a year"})` : ""}`],
        ["Pay scale / basic pay", e.payScale],
        ["Probation declared", e.probationDeclaredOn && fullDate(e.probationDeclaredOn)],
        ["Home address", e.address && <span className="whitespace-pre-wrap">{e.address}</span>],
        ["Notes", e.notes && <span className="whitespace-pre-wrap">{e.notes}</span>],
      ]
    : // Temporary employees (user request 2026-10-07): only their own details.
      [
        ["Employment", ["Temporary", ENGAGEMENT_LABELS[e.engagement as Engagement]].filter(Boolean).join(" · ")],
        ["Type", typeName],
        ["Phone", e.phone],
        ["Email", e.email && <a href={`mailto:${e.email}`} className="text-brand-700 hover:underline">{e.email}</a>],
        ["Category", e.category],
        ["Date of birth", e.dateOfBirth && `${fullDate(e.dateOfBirth)} (${yearsBetween(e.dateOfBirth, today)} years)`],
        ["Date of joining", e.joinedServiceOn && fullDate(e.joinedServiceOn)],
        ["Contract period", e.contractDays && plural(e.contractDays, "day")],
        ["Pay per day", e.payPerDay != null && rupees(e.payPerDay)],
        ["Contract end date", e.engagedTill && <span className={cx(ended && "font-medium text-urgent-ink")}>{fullDate(e.engagedTill)}{ended && " (ended)"}</span>],
      ];
  const del = () => {
    if (!confirm(`Delete ${e.name}? Use "Left the office" instead to keep them on old tasks.`)) return;
    removeEmployee.mutate(e.id, { onSuccess: onClose });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Avatar name={e.name} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{e.name}</h3>
          <p className="text-sm text-slate-600">{designation ?? "No designation"}</p>
          {(!e.permanent || e.leftOn) && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {!e.permanent && <TemporaryTag />}
              {e.leftOn && <Badge>Left the office on {fullDate(e.leftOn)}</Badge>}
            </div>
          )}
        </div>
      </div>

      {digits && (
        <div className="flex flex-wrap gap-2">
          <a href={`tel:${e.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-slate-50 active:scale-[0.97]">
            <Phone size={15} /> Call
          </a>
          <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-slate-50 active:scale-[0.97]">
            <MessageCircle size={15} /> WhatsApp
          </a>
          {e.email && (
            <a href={`mailto:${e.email}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-slate-50 active:scale-[0.97]">
              <Mail size={15} /> Email
            </a>
          )}
        </div>
      )}

      <dl className="space-y-2 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex items-start gap-3">
              <dt className="w-32 shrink-0 leading-5 text-slate-500 sm:w-40">{k}</dt>
              <dd className="min-w-0 flex-1 leading-5 text-ink [overflow-wrap:anywhere] select-text">{v}</dd>
            </div>
          ))}
      </dl>

      {/* Open work about them or their designation (user's choice 2026-10-07). */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">Open tasks and reminders</p>
        {work.isLoading ? (
          <Loading className="py-4" />
        ) : !work.data?.tasks.length && !work.data?.reminders.length ? (
          <p className="text-footnote text-slate-500">No open tasks or reminders.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {work.data!.tasks.map((t) => (
              <li key={t.id}>
                <button onClick={() => setTask(t)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  {t.relatedKind === "designation" ? <UsersRound size={14} className="mt-[3px] shrink-0 text-slate-400" /> : <UserRound size={14} className="mt-[3px] shrink-0 text-slate-400" />}
                  <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{t.title}</span>
                  {t.dueDate && (
                    <span className={cx("shrink-0 text-footnote", t.dueDate < today ? "text-urgent-ink" : "text-slate-500")}>
                      {formatDay(t.dueDate, today)}
                      {t.dueTime && `, ${formatTime(t.dueTime)}`}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {work.data!.reminders.map((r) => (
              <li key={r.id}>
                <button onClick={() => navigate("/reminders")} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <CalendarClock size={14} className="mt-[3px] shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="shrink-0 text-footnote text-slate-500">{r.active ? "Reminder" : "Paused"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ErrorNote error={setLeft.error ?? removeEmployee.error} />
      <div className="sticky bottom-0 z-[1] -mb-5 flex flex-wrap items-center gap-2 border-t border-line bg-white pt-4 pb-5 max-sm:-mb-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:[&>button]:flex-1 max-sm:[&>button]:px-2">
        <Button variant="danger" onClick={del} disabled={busy} aria-label="Delete employee" title="Delete employee" className="max-sm:flex-none!">
          <Trash2 size={15} />
        </Button>
        <Button onClick={() => onEdit(e)} className="sm:mr-auto">
          <Pencil size={15} /> Edit
        </Button>
        <Button onClick={() => setLeft.mutate({ id: e.id, left: !e.leftOn })} disabled={busy}>
          {e.leftOn ? <UserPlus size={15} /> : <UserMinus size={15} />} {e.leftOn ? "Back in office" : "Left the office"}
        </Button>
      </div>

      <TaskDetails task={task} onClose={() => setTask(null)} onEdit={(t) => {
        setTask(null);
        setTaskForm({ kind: "edit", task: t });
      }} />
      <TaskDialog mode={taskForm} onClose={() => setTaskForm(null)} />
    </div>
  );
}

// --- Add / edit an employee ---

const EMPTY: EmployeeInput = {
  name: "",
  designationId: null,
  permanent: true,
  engagedTill: null,
  pen: "",
  phone: "",
  email: "",
  dateOfBirth: null,
  category: "",
  joinedServiceOn: null,
  joinedOfficeOn: null,
  nextIncrementOn: null,
  retiresOn: null,
  payScale: "",
  probationDeclaredOn: null,
  address: "",
  notes: "",
};

function EmployeeDialog({ open, employee, staff, onClose }: { open: boolean; employee: Employee | null; staff: StaffList; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={employee ? "Edit employee" : "Add employee"}>
      {open && <EmployeeForm employee={employee} staff={staff} onDone={onClose} />}
    </Modal>
  );
}

function EmployeeForm({ employee, staff, onDone }: { employee: Employee | null; staff: StaffList; onDone: () => void }) {
  const [v, setV] = useState<EmployeeInput>(() => {
    if (!employee) return EMPTY;
    const { id: _id, leftOn: _left, ...rest } = employee;
    return { ...rest, category: rest.category as EmployeeInput["category"], engagement: rest.engagement as EmployeeInput["engagement"] };
  });
  const set = <K extends keyof EmployeeInput>(k: K, value: EmployeeInput[K]) => setV((s) => ({ ...s, [k]: value }));
  const { addEmployee, saveEmployee } = useStaffActions();
  const save = employee ? saveEmployee : addEmployee;
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    try {
      if (employee) await saveEmployee.mutateAsync({ id: employee.id, input: v });
      else await addEmployee.mutateAsync(v);
      onDone();
    } catch {
      // shown under the form
    }
  };
  // Contract end date follows date of joining + contract days while it is empty or still the worked-out one.
  const setContract = (patch: Pick<EmployeeInput, "joinedServiceOn" | "contractDays">) =>
    setV((s) => {
      const auto = (x: EmployeeInput) => (x.joinedServiceOn && x.contractDays ? contractEnd(x.joinedServiceOn, x.contractDays) : null);
      const next = { ...s, ...patch };
      return !s.engagedTill || s.engagedTill === auto(s) ? { ...next, engagedTill: auto(next) ?? s.engagedTill ?? null } : next;
    });
  const num = (raw: string, int: boolean) => (raw.trim() === "" ? null : int ? Math.round(Number(raw)) : Number(raw));
  const date = (k: "dateOfBirth" | "joinedServiceOn" | "joinedOfficeOn" | "nextIncrementOn" | "retiresOn" | "probationDeclaredOn" | "engagedTill", label: string) => (
    <Field label={label}>
      <input type="date" className={inputClass} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value || null)} />
    </Field>
  );
  const text = (k: "pen" | "phone" | "email" | "payScale", label: string, extra?: Partial<React.InputHTMLAttributes<HTMLInputElement>>) => (
    <Field label={label}>
      <input className={inputClass} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} {...extra} />
    </Field>
  );

  const category = (
    <Field label="Category">
      <select className={inputClass} value={v.category} onChange={(e) => set("category", e.target.value as EmployeeInput["category"])}>
        <option value="">Not given</option>
        {EMPLOYEE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Employment</span>
        {/* Its own buttons (type="button"), so choosing never submits the form. */}
        <div role="radiogroup" aria-label="Employment" className="inline-flex flex-wrap gap-1.5">
          {([
            [true, "Permanent"],
            [false, "Temporary"],
          ] as const).map(([permanent, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={v.permanent === permanent}
              onClick={() => set("permanent", permanent)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Name">
        <input className={inputClass} value={v.name} onChange={(e) => set("name", e.target.value)} required autoFocus={!employee} maxLength={120} />
      </Field>
      <Field label="Designation">
        <select className={inputClass} value={v.designationId ?? ""} onChange={(e) => set("designationId", e.target.value || null)}>
          <option value="">No designation</option>
          {staff.designations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      {staff.designations.length === 0 && <p className="-mt-2 text-footnote text-slate-500">Add designations in Settings › Employees.</p>}

      {v.permanent ? (
        <>
          <Section title="Personal">
            {text("pen", "PEN", { inputMode: "numeric", maxLength: 20 })}
            {text("phone", "Phone", { type: "tel", inputMode: "tel", maxLength: 20 })}
            {text("email", "Email", { type: "email", inputMode: "email", autoCapitalize: "off", maxLength: 200 })}
            {date("dateOfBirth", "Date of birth")}
            {category}
          </Section>
          <Section title="Service">
            {date("joinedServiceOn", "Joined service on")}
            {date("joinedOfficeOn", "Joined this office on")}
            {date("nextIncrementOn", "Next increment date")}
            {date("retiresOn", "Date of retirement")}
            {date("probationDeclaredOn", "Probation declared on")}
            {text("payScale", "Pay scale / basic pay", { maxLength: 100, placeholder: "e.g. 35600-75400" })}
          </Section>
          <Field label="Home address">
            <textarea className={cx(inputClass, "h-auto py-2")} rows={3} value={v.address} onChange={(e) => set("address", e.target.value)} maxLength={500} />
          </Field>
          <Field label="Notes">
            <textarea className={cx(inputClass, "h-auto py-2")} rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={5000} />
          </Field>
        </>
      ) : (
        // Temporary employees (user request 2026-10-07): only these details.
        <>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Engaged as</span>
            <div role="radiogroup" aria-label="Engaged as" className="flex flex-wrap gap-1.5">
              {ENGAGEMENTS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={v.engagement === g}
                  onClick={() => set("engagement", v.engagement === g ? "" : g)}
                  className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800"
                >
                  {ENGAGEMENT_LABELS[g]}
                </button>
              ))}
            </div>
          </div>
          <Field label="Type">
            <select className={inputClass} value={v.typeId ?? ""} onChange={(e) => set("typeId", e.target.value || null)}>
              <option value="">Not given</option>
              {staff.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          {staff.types.length === 0 && <p className="-mt-2 text-footnote text-slate-500">Add types (HMC, NHM…) in Settings › Employees.</p>}
          <Section title="Personal">
            {text("phone", "Phone", { type: "tel", inputMode: "tel", maxLength: 20 })}
            {text("email", "Email", { type: "email", inputMode: "email", autoCapitalize: "off", maxLength: 200 })}
            {category}
            {date("dateOfBirth", "Date of birth")}
          </Section>
          <Section title="Contract">
            <Field label="Date of joining">
              <input type="date" className={inputClass} value={v.joinedServiceOn ?? ""} onChange={(e) => setContract({ joinedServiceOn: e.target.value || null, contractDays: v.contractDays ?? null })} />
            </Field>
            <Field label="Contract period (days)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                step={1}
                className={inputClass}
                value={v.contractDays ?? ""}
                onChange={(e) => setContract({ joinedServiceOn: v.joinedServiceOn ?? null, contractDays: num(e.target.value, true) })}
                placeholder="e.g. 179"
              />
            </Field>
            <Field label="Pay per day (₹)">
              <input type="number" inputMode="decimal" min={0} step="0.01" className={inputClass} value={v.payPerDay ?? ""} onChange={(e) => set("payPerDay", num(e.target.value, false))} placeholder="e.g. 755" />
            </Field>
            {date("engagedTill", "Contract end date")}
          </Section>
        </>
      )}
      <ErrorNote error={save.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          <Check size={16} /> {employee ? "Save" : "Add employee"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-line pt-3">
      <legend className="pr-2 text-footnote font-medium text-slate-500">{title}</legend>
      {/* Two per row where they fit; one per row on narrow phones. */}
      <div className="grid gap-3 min-[400px]:grid-cols-2">{children}</div>
    </fieldset>
  );
}
