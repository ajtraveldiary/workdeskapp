// An employee's own page (user request 2026-10-08, "clicking a row in employee list: all details related to
// them"; user's choice: a full page). Opened from the Employees list or table at /employees/<id>. Shows every
// detail, an "at a glance" summary (basic pay, increment, probation, retirement and pension papers, or the
// contract for temporary staff), all tasks about them or their designation (open and completed), their
// reminders and a History of every change about them, with Edit, Left the office and Delete.
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { BadgeCheck, CalendarClock, ChevronLeft, FileClock, Hourglass, ListChecks, Mail, MessageCircle, Pencil, Phone, Trash2, TrendingUp, UserMinus, UserPlus, Wallet } from "lucide-react";
import type { AuditEvent, Employee, StaffList, Task } from "../../shared/types";
import { ENGAGEMENT_LABELS, PROBATION_LOOKBACK_YEARS, incrementDue, probationDue, type Engagement } from "../../shared/staff";
import { useEmployeeProfile, useMe, useStaff, useStaffActions } from "../api";
import { formatDateTime } from "../format";
import { Avatar } from "../components/Avatar";
import { ChecklistChip } from "../components/Checklist";
import { openIncrement } from "../components/IncrementDialog";
import { RefreshButton } from "../components/RefreshButton";
import { asksChoice, openTaskChoice } from "../components/SystemTaskChooser";
import { TaskDetails } from "../components/TaskDetails";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { TaskRow } from "../components/TaskRow";
import { Badge, Button, Card, ErrorNote, Segmented, SkeletonList, cx } from "../components/ui";
import { EmployeeDialog, TemporaryTag } from "./Staff";

const fullDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
function yearsBetween(a: string, b: string) {
  let y = Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  if (b.slice(5) < a.slice(5)) y--;
  return y;
}
// "in 3 years", "in 8 months", "in 12 days" (or "today").
function until(today: string, day: string) {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 60) return `in ${plural(days, "day")}`;
  if (days < 730) return `in ${plural(Math.round(days / 30.44), "month")}`;
  return `in ${plural(yearsBetween(today, day), "year")}`;
}

export function EmployeePage() {
  const { id = "" } = useParams();
  const { data: staff, error } = useStaff();
  const employee = staff?.employees.find((e) => e.id === id);
  if (error) return <p className="text-urgent-ink">{error.message}</p>;
  if (!staff) return <SkeletonList rows={6} />;
  if (!employee)
    return (
      <>
        <BackLink />
        <Card className="px-6 py-10 text-center text-sm text-slate-500">This employee isn't in the list any more.</Card>
      </>
    );
  return <Profile key={employee.id} e={employee} staff={staff} />;
}

// Back to the list as it was left (table and filters), or to the Employees page when opened from a link.
function BackLink() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      onClick={() => (location.key !== "default" ? navigate(-1) : navigate("/employees"))}
      className="-ml-1 mb-2 inline-flex items-center gap-0.5 text-sm font-medium text-brand-700 hover:underline active:scale-[0.97]"
    >
      <ChevronLeft size={18} /> Employees
    </button>
  );
}

function Profile({ e, staff }: { e: Employee; staff: StaffList }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const profile = useEmployeeProfile(e.id);
  const { setLeft, removeEmployee } = useStaffActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const designation = staff.designations.find((d) => d.id === e.designationId)?.name;
  const digits = e.phone.replace(/\D/g, "");
  const whatsapp = digits.length === 10 ? `91${digits}` : digits;
  const busy = setLeft.isPending || removeEmployee.isPending;
  const del = () => {
    if (!confirm(`Delete ${e.name}? Use "Left the office" instead to keep them on old tasks.`)) return;
    removeEmployee.mutate(e.id, { onSuccess: () => navigate("/employees", { replace: true }) });
  };
  const contact = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-slate-50 active:scale-[0.97] pointer-coarse:h-9";

  return (
    <>
      <BackLink />
      {/* Who they are, how to reach them, and what can be done (Edit, Left the office, Delete). */}
      <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-3">
        <Avatar name={e.name} size={56} />
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="text-title3 font-semibold text-ink [overflow-wrap:anywhere] select-text sm:text-title2">{e.name}</h1>
          <p className="text-sm text-slate-600">
            {designation ?? "No designation"}
            {e.permanent && e.pen && <span className="select-text"> · PEN {e.pen}</span>}
          </p>
          {(!e.permanent || e.leftOn) && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {!e.permanent && <TemporaryTag />}
              {e.leftOn && <Badge>Left the office on {fullDate(e.leftOn)}</Badge>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton keys={[["staff"], ["tasks"]]} label="Refresh employee" />
          <Button onClick={() => setEditing(true)}>
            <Pencil size={15} /> Edit
          </Button>
          <Button onClick={() => setLeft.mutate({ id: e.id, left: !e.leftOn })} disabled={busy}>
            {e.leftOn ? <UserPlus size={15} /> : <UserMinus size={15} />} {e.leftOn ? "Back in office" : "Left the office"}
          </Button>
          <Button variant="danger" onClick={del} disabled={busy} aria-label="Delete employee" title="Delete">
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      {(digits || e.email) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {digits && (
            <a href={`tel:${e.phone.replace(/[^\d+]/g, "")}`} className={contact}>
              <Phone size={15} /> Call
            </a>
          )}
          {digits && (
            <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className={contact}>
              <MessageCircle size={15} /> WhatsApp
            </a>
          )}
          {e.email && (
            <a href={`mailto:${e.email}`} className={contact}>
              <Mail size={15} /> Email
            </a>
          )}
        </div>
      )}
      <ErrorNote error={setLeft.error ?? removeEmployee.error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <AtAGlance e={e} today={today} tasks={[...(profile.data?.open ?? []), ...(profile.data?.done ?? [])]} />
          <AllDetails e={e} staff={staff} today={today} />
        </div>
        <div className="space-y-4">
          <Work profile={profile.data} loading={profile.isLoading} designation={designation} />
          <HistoryCard events={profile.data?.history} loading={profile.isLoading} />
        </div>
      </div>
      <EmployeeDialog open={editing} employee={editing ? e : null} staff={staff} onClose={() => setEditing(false)} />
    </>
  );
}

// --- At a glance: what needs attention about them ---

function AtAGlance({ e, today, tasks }: { e: Employee; today: string; tasks: Task[] }) {
  const [task, setTask] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskDialogMode | null>(null);
  const kind = (k: Task["systemKind"]) => tasks.find((t) => t.systemKind === k && t.relatedId === e.id && t.status === "open") ?? tasks.find((t) => t.systemKind === k && t.relatedId === e.id);
  const items: { icon: typeof Wallet; label: string; value: ReactNode; action?: ReactNode }[] = [];
  const taskChip = (t: Task | undefined, done: string) =>
    t &&
    (t.status === "done" ? (
      <button type="button" onClick={() => setTask(t)} className="text-footnote font-medium text-low-ink hover:underline">
        {done}
      </button>
    ) : asksChoice(t) ? (
      <Button size="sm" onClick={() => openTaskChoice(t)}>
        {t.systemKind === "probation" ? "Declare or extend" : "Renew or end"}
      </Button>
    ) : t.checklist.length ? (
      <span className="text-footnote">
        <ChecklistChip items={t.checklist} onClick={() => setTask(t)} />
      </span>
    ) : (
      <Button size="sm" onClick={() => setTask(t)}>
        Task
      </Button>
    ));

  if (e.permanent) {
    items.push({ icon: Wallet, label: "Basic pay", value: e.basicPay != null ? rupees(e.basicPay) : <Muted>Not given</Muted> });
    const incDue = incrementDue(e.nextIncrementOn, today);
    items.push({
      icon: TrendingUp,
      label: "Next increment",
      value: e.nextIncrementOn ? (
        <span className={cx(e.nextIncrementOn < today && "font-medium text-urgent-ink")}>
          {fullDate(e.nextIncrementOn)}
          {e.nextIncrementOn < today ? " (passed)" : ` (${until(today, e.nextIncrementOn)})`}
        </span>
      ) : (
        <Muted>Not given</Muted>
      ),
      action: incDue && !e.leftOn && (
        <Button size="sm" onClick={() => openIncrement({ employeeId: e.id, name: e.name, due: e.nextIncrementOn!, basicPay: e.basicPay ?? null })}>
          Mark done
        </Button>
      ),
    });
    const probation = kind("probation");
    items.push({
      icon: BadgeCheck,
      label: "Probation",
      value: e.probationDeclaredOn ? (
        `Declared on ${fullDate(e.probationDeclaredOn)}`
      ) : e.joinedServiceOn && probationDue(e.joinedServiceOn) < `${Number(today.slice(0, 4)) - PROBATION_LOOKBACK_YEARS}${today.slice(4)}` ? (
        // Long-serving staff: the declared date just wasn't entered (no task is made for them either).
        <Muted>Declared date not entered</Muted>
      ) : e.joinedServiceOn ? (
        <span className={cx(probationDue(e.joinedServiceOn) < today && "font-medium text-high-ink")}>
          Not declared · 2 years {probationDue(e.joinedServiceOn) < today ? "completed" : "complete"} {fullDate(probationDue(e.joinedServiceOn))}
        </span>
      ) : (
        <Muted>Not declared</Muted>
      ),
      action: !e.probationDeclaredOn && taskChip(probation, "Done"),
    });
    const pension = kind("pension");
    items.push({
      icon: Hourglass,
      label: "Retirement",
      value: e.retiresOn ? (
        <span className={cx(e.retiresOn < today && "font-medium text-urgent-ink")}>
          {fullDate(e.retiresOn)} ({e.retiresOn < today ? "retired" : until(today, e.retiresOn)})
        </span>
      ) : (
        <Muted>Not given</Muted>
      ),
      action: taskChip(pension, "Papers sent"),
    });
  } else {
    const ended = !!e.engagedTill && e.engagedTill < today;
    items.push({
      icon: FileClock,
      label: "Contract ends",
      value: e.engagedTill ? (
        <span className={cx(ended && "font-medium text-urgent-ink")}>
          {fullDate(e.engagedTill)} ({ended ? "ended" : until(today, e.engagedTill)})
        </span>
      ) : (
        <Muted>Not given</Muted>
      ),
      action: taskChip(kind("contract"), "Dealt with"),
    });
    items.push({ icon: CalendarClock, label: "Contract period", value: e.contractDays ? plural(e.contractDays, "day") : <Muted>Not given</Muted> });
    items.push({ icon: Wallet, label: "Pay per day", value: e.payPerDay != null ? rupees(e.payPerDay) : <Muted>Not given</Muted> });
  }

  return (
    <Card className="overflow-hidden">
      <CardTitle>At a glance</CardTitle>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.label} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-5">
            <it.icon size={16} className="shrink-0 text-brand-700" />
            <span className="w-28 shrink-0 text-footnote text-slate-500">{it.label}</span>
            <span className="min-w-0 flex-1 basis-32 text-sm text-ink [overflow-wrap:anywhere]">{it.value}</span>
            {it.action}
          </li>
        ))}
      </ul>
      <TaskDetails
        task={task}
        onClose={() => setTask(null)}
        onEdit={(t) => {
          setTask(null);
          setForm({ kind: "edit", task: t });
        }}
      />
      <TaskDialog mode={form} onClose={() => setForm(null)} />
    </Card>
  );
}

// --- Every detail, grouped like the form ---

function AllDetails({ e, staff, today }: { e: Employee; staff: StaffList; today: string }) {
  const typeName = staff.types.find((t) => t.id === e.typeId)?.name;
  const email = e.email && (
    <a href={`mailto:${e.email}`} className="text-brand-700 hover:underline">
      {e.email}
    </a>
  );
  const dob = e.dateOfBirth && `${fullDate(e.dateOfBirth)} (${yearsBetween(e.dateOfBirth, today)} years)`;
  const groups: [string, [string, ReactNode][]][] = e.permanent
    ? [
        ["Personal", [["PEN", e.pen], ["Phone", e.phone], ["Email", email], ["Date of birth", dob], ["Category", e.category]]],
        [
          "Service",
          [
            ["Joined service", e.joinedServiceOn && `${fullDate(e.joinedServiceOn)} (${plural(Math.max(0, yearsBetween(e.joinedServiceOn, today)), "year")} of service)`],
            ["Joined this office", e.joinedOfficeOn && fullDate(e.joinedOfficeOn)],
            ["Next increment", e.nextIncrementOn && fullDate(e.nextIncrementOn)],
            ["Probation declared", e.probationDeclaredOn && fullDate(e.probationDeclaredOn)],
            ["Retirement", e.retiresOn && fullDate(e.retiresOn)],
          ],
        ],
        ["Pay", [["Basic pay", e.basicPay != null && rupees(e.basicPay)], ["Pay scale", e.payScale]]],
        [
          "Other",
          [
            ["Home address", e.address && <span className="whitespace-pre-wrap">{e.address}</span>],
            ["Notes", e.notes && <span className="whitespace-pre-wrap">{e.notes}</span>],
          ],
        ],
      ]
    : [
        [
          "Engagement",
          [
            ["Engaged as", ENGAGEMENT_LABELS[e.engagement as Engagement]],
            ["Type", typeName],
            ["Date of joining", e.joinedServiceOn && fullDate(e.joinedServiceOn)],
            ["Contract period", e.contractDays && plural(e.contractDays, "day")],
            ["Contract end date", e.engagedTill && fullDate(e.engagedTill)],
            ["Pay per day", e.payPerDay != null && rupees(e.payPerDay)],
          ],
        ],
        ["Personal", [["Phone", e.phone], ["Email", email], ["Date of birth", dob], ["Category", e.category]]],
      ];
  return (
    <Card className="overflow-hidden">
      <CardTitle>Details</CardTitle>
      <div className="divide-y divide-line">
        {groups.map(([title, rows]) => (
          <section key={title} className="px-4 py-3 sm:px-5">
            <h3 className="mb-1.5 text-caption font-semibold text-slate-500">{title}</h3>
            <dl className="space-y-1.5 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-start gap-3">
                  <dt className="w-32 shrink-0 leading-5 text-slate-500 sm:w-36">{k}</dt>
                  <dd className="min-w-0 flex-1 leading-5 text-ink [overflow-wrap:anywhere] select-text">{v || <Muted>Not given</Muted>}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Card>
  );
}

// --- Tasks (open / completed) and reminders about them or their designation ---

function Work({ profile, loading, designation }: { profile: ReturnType<typeof useEmployeeProfile>["data"]; loading: boolean; designation?: string }) {
  const [tab, setTab] = useState<"open" | "done">("open");
  const [details, setDetails] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskDialogMode | null>(null);
  const list = tab === "open" ? profile?.open : profile?.done;
  return (
    <>
      <Card className="overflow-hidden">
        <CardTitle icon={ListChecks}>Tasks</CardTitle>
        <div className="px-4 pt-3 sm:px-5">
          <Segmented<"open" | "done">
            value={tab}
            onChange={setTab}
            oneRow
            options={[
              { value: "open", label: "Open", count: profile?.open.length },
              { value: "done", label: "Completed", count: profile?.done.length },
            ]}
          />
        </div>
        {loading ? (
          <SkeletonList rows={3} />
        ) : !list?.length ? (
          <p className="px-4 py-6 text-center text-footnote text-slate-500 sm:px-5">{tab === "open" ? "No open tasks about them." : "No completed tasks yet."}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-t border-line">
            {list.map((t) => (
              <TaskRow key={t.id} task={t} today={profile!.today} onEdit={(task) => setForm({ kind: "edit", task })} onOpen={setDetails} onDetails={setDetails} />
            ))}
          </ul>
        )}
        <TaskDetails
          task={details}
          onClose={() => setDetails(null)}
          onEdit={(t) => {
            setDetails(null);
            setForm({ kind: "edit", task: t });
          }}
        />
        <TaskDialog mode={form} onClose={() => setForm(null)} />
      </Card>
      <Card className="overflow-hidden">
        <CardTitle icon={CalendarClock}>Reminders</CardTitle>
        {loading ? (
          <SkeletonList rows={2} />
        ) : !profile?.reminders.length ? (
          <p className="px-4 py-5 text-center text-footnote text-slate-500 sm:px-5">No reminders about them.</p>
        ) : (
          <ul className="divide-y divide-line">
            {profile.reminders.map((r) => (
              <li key={r.id} className="row-click flex items-center gap-3 px-4 py-2.5 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5">
                <Link to="/reminders" className="row-link group/title min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere] group-hover/title:text-brand-700">
                  <span className="group-hover/title:text-brand-700">{r.name}</span>
                  {r.relatedKind === "designation" && designation && <span className="block text-footnote text-slate-500">For all {designation}</span>}
                </Link>
                <span className={cx("shrink-0 text-footnote", r.active ? "text-slate-500" : "text-high-ink")}>{r.active ? "Active" : "Paused"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// --- History: their tasks' entries and every staff change that names them ---

function HistoryCard({ events, loading }: { events?: AuditEvent[]; loading: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events?.slice(0, 15);
  return (
    <Card className="overflow-hidden">
      <CardTitle>History</CardTitle>
      {loading ? (
        <SkeletonList rows={3} />
      ) : !events?.length ? (
        <p className="px-4 py-5 text-center text-footnote text-slate-500 sm:px-5">Nothing recorded yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {shown!.map((h) => (
              <li key={h.id} className="px-4 py-2.5 sm:px-5">
                {h.detail?.title && <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{h.detail.title}</p>}
                <p className="text-footnote text-slate-600 [overflow-wrap:anywhere]">
                  {h.summary}
                  <span className="text-slate-400"> · {formatDateTime(h.createdAt)}</span>
                </p>
              </li>
            ))}
          </ul>
          {events.length > 15 && !all && (
            <button type="button" onClick={() => setAll(true)} className="w-full border-t border-line px-4 py-2.5 text-footnote font-medium text-brand-700 hover:bg-slate-50">
              Show all {events.length}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function CardTitle({ children, icon: Icon }: { children: ReactNode; icon?: typeof Wallet }) {
  return (
    <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-footnote font-semibold text-slate-600 sm:px-5">
      {Icon && <Icon size={15} className="text-brand-700" />}
      {children}
    </h2>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-slate-400">{children}</span>;
