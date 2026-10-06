import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, CircleCheck, Clock, FileText, Plus, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Report, ReportPeriod } from "../../shared/types";
import { FREQUENCY_LABEL, monthIndex, periodsFrom, ruleText, shortLabel, type Period } from "../../shared/reportSchedule";
import { useDeleteReport, useReports, useSetPeriodStatus, useUpdateReport } from "../api";
import { addDays, formatDateTime, formatDay } from "../format";
import { ReportDialog, type ReportDialogMode } from "../components/ReportDialog";
import { Badge, Button, Card, Menu, PageHeader, TONE, cx, type Tone } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WINDOW = 9; // months shown in the reporting calendar

type Status = "submitted" | "overdue" | "due_soon" | "upcoming";

// Submitted = green, overdue = red, due within the report's lead time = orange, later = blue.
function periodStatus(p: ReportPeriod, today: string, leadDays: number): Status {
  if (p.status === "submitted") return "submitted";
  if (p.dueDate < today) return "overdue";
  if (p.dueDate <= addDays(today, Math.max(leadDays, 7))) return "due_soon";
  return "upcoming";
}

const STATUS: Record<Status, { tone: Tone; label: string }> = {
  submitted: { tone: "low", label: "Submitted" },
  overdue: { tone: "urgent", label: "Overdue" },
  due_soon: { tone: "high", label: "Due soon" },
  upcoming: { tone: "info", label: "Upcoming" },
};

export function ReportsPage() {
  const { data, error } = useReports();
  const [dialog, setDialog] = useState<ReportDialogMode | null>(null);

  if (error) return <p className="text-urgent-ink">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { reports, today } = data;

  const pending = reports.flatMap((r) => r.periods.filter((p) => p.status === "pending").map((p) => ({ report: r, period: p })));
  const overdue = pending.filter((x) => x.period.dueDate < today);
  const next30 = pending.filter((x) => x.period.dueDate >= today && x.period.dueDate <= addDays(today, 30));
  const submittedThisMonth = reports.flatMap((r) => r.periods).filter((p) => p.submittedAt && p.submittedAt.slice(0, 7) === today.slice(0, 7)).length;
  const dueNext = [...overdue, ...next30].sort((a, b) => a.period.dueDate.localeCompare(b.period.dueDate));

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Recurring reporting duties. Every period gets its own task and is tracked on its own."
        actions={
          <>
            <RefreshButton keys={[["reports"], ["summary"], ["tasks"]]} label="Refresh reports" />
            <Button variant="primary" onClick={() => setDialog({ kind: "new" })}>
              <Plus size={17} /> New report
            </Button>
          </>
        }
      />

      {reports.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-info text-white">
            <FileText size={22} />
          </span>
          <p className="mt-3 font-medium text-ink">No recurring reports yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Add duties like the monthly expenditure statement or the annual report. WorkDesk creates a task before each one is due and
            keeps a record of every period.
          </p>
          <Button variant="primary" className="mt-4" onClick={() => setDialog({ kind: "new" })}>
            <Plus size={17} /> Add your first report
          </Button>
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Tile icon={TriangleAlert} value={overdue.length} label="Overdue" tone={overdue.length ? "urgent" : "low"} />
            <Tile icon={Clock} value={next30.length} label="Due in 30 days" tone={next30.length ? "high" : "low"} />
            <Tile icon={CircleCheck} value={submittedThisMonth} label="Submitted this month" tone="low" />
          </div>

          <Card>
            <h2 className="border-b border-line px-5 py-3.5 text-[1.0625rem] font-semibold text-ink">Due next</h2>
            {dueNext.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing due in the next 30 days.</p>
            ) : (
              <ul className="divide-y divide-line">
                {dueNext.map(({ report, period }) => (
                  <DueRow key={period.id} report={report} period={period} today={today} />
                ))}
              </ul>
            )}
          </Card>

          <ReportingCalendar reports={reports} today={today} onEdit={(report) => setDialog({ kind: "edit", report })} />
        </div>
      )}

      <ReportDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function Tile({ icon: Icon, value, label, tone }: { icon: LucideIcon; value: number; label: string; tone: Tone }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-xl border border-line bg-white p-2.5 sm:flex-row sm:items-center sm:gap-3 sm:p-3.5">
      <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-md shadow-sm sm:size-10 sm:rounded-lg", TONE[tone].solid)}>
        <Icon strokeWidth={1.8} className="size-4 sm:size-5" />
      </span>
      <div className="min-w-0">
        <div className={cx("text-lg leading-none font-semibold tabular-nums sm:text-2xl", tone === "urgent" ? "text-urgent-ink" : "text-ink")}>{String(value).padStart(2, "0")}</div>
        <div className="mt-1 text-[0.6875rem] leading-tight font-medium text-ink sm:text-[0.8125rem] sm:leading-snug">{label}</div>
      </div>
    </div>
  );
}

function DueRow({ report, period, today }: { report: Report; period: ReportPeriod; today: string }) {
  const setStatus = useSetPeriodStatus();
  const s = STATUS[periodStatus(period, today, report.leadDays)];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <span className={cx("size-2.5 shrink-0 rounded-full", TONE[s.tone].dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">
          {report.name} <span className="font-normal text-slate-500">· {period.label}</span>
        </p>
        <p className="truncate text-[0.8125rem] text-slate-500">
          {FREQUENCY_LABEL[report.frequency]}
          {report.responsible && ` · ${report.responsible}`}
        </p>
      </div>
      <Badge tone={s.tone}>
        {period.dueDate < today ? `Overdue · was due ${formatDay(period.dueDate, today)}` : `Due ${formatDay(period.dueDate, today)}`}
      </Badge>
      <Button size="sm" onClick={() => setStatus.mutate({ id: period.id, submitted: true })} disabled={setStatus.isPending}>
        <Check size={15} /> Mark submitted
      </Button>
    </li>
  );
}

// --- Reporting calendar: one row per report, one column per month (by due date) ---

function ReportingCalendar({ reports, today, onEdit }: { reports: Report[]; today: string; onEdit: (r: Report) => void }) {
  const [shift, setShift] = useState(0);
  const thisMonth = monthIndex(today);
  const first = thisMonth - 5 + shift;
  const months = Array.from({ length: WINDOW }, (_, i) => first + i);
  const last = months.at(-1)!;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[1.0625rem] font-semibold text-ink">Reporting calendar</h2>
          <p className="text-[0.8125rem] text-slate-500">Each period appears in the month it is due. Click one to update it.</p>
        </div>
        <div className="flex items-center gap-1">
          {shift !== 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShift(0)}>
              This month
            </Button>
          )}
          <button onClick={() => setShift((s) => s - 3)} className="rounded-lg p-1.5 hover:bg-slate-100 pointer-coarse:p-2" aria-label="Earlier months">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setShift((s) => s + 3)} className="rounded-lg p-1.5 hover:bg-slate-100 pointer-coarse:p-2" aria-label="Later months">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="sticky left-0 z-10 w-64 bg-white px-5 py-2.5 text-left font-medium">Report</th>
              {months.map((m) => (
                <th key={m} className={cx("px-1 py-2.5 text-center font-medium", m === thisMonth && "bg-tint text-brand-700")}>
                  {MONTH_SHORT[m % 12]}
                  {(m % 12 === 0 || m === first) && <span className="block text-[0.625rem] font-normal text-slate-400">{Math.floor(m / 12)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <CalendarRow key={r.id} report={r} months={months} last={last} thisMonth={thisMonth} today={today} onEdit={onEdit} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-5 py-3 text-xs text-slate-600">
        {(Object.keys(STATUS) as Status[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cx("size-2 rounded-full", TONE[STATUS[k].tone].dot)} /> {STATUS[k].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border border-dashed border-slate-400" /> Scheduled (task not created yet)
        </span>
      </div>
    </Card>
  );
}

function CalendarRow({
  report,
  months,
  last,
  thisMonth,
  today,
  onEdit,
}: {
  report: Report;
  months: number[];
  last: number;
  thisMonth: number;
  today: string;
  onEdit: (r: Report) => void;
}) {
  const update = useUpdateReport();
  const remove = useDeleteReport();
  const generated = new Set(report.periods.map((p) => p.periodStart));
  // Future periods whose task hasn't been created yet, from the report's rule.
  const scheduled: Period[] = report.active
    ? periodsFrom(report, report.firstPeriodStart, (p) => monthIndex(p.dueDate) <= last, 240).filter(
        (p) => !generated.has(p.periodStart) && addDays(p.dueDate, -report.leadDays) > today,
      )
    : [];

  return (
    <tr className={cx("border-t border-line", !report.active && "opacity-60")}>
      <td className="sticky left-0 z-10 bg-white px-5 py-3 align-top">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{report.name}</p>
            <p className="text-xs text-slate-500">
              {FREQUENCY_LABEL[report.frequency]}
              {report.responsible && ` · ${report.responsible}`}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">{ruleText(report)}</p>
            {!report.active && <Badge>Paused</Badge>}
          </div>
          <Menu
            items={[
              { label: "Edit", onClick: () => onEdit(report) },
              { label: report.active ? "Pause" : "Resume", onClick: () => update.mutate({ id: report.id, input: { active: !report.active } }) },
              {
                label: "Delete",
                onClick: () =>
                  confirm(`Delete "${report.name}"? Its periods and open tasks are removed. Completed tasks stay in History.`) && remove.mutate(report.id),
              },
            ]}
          />
        </div>
      </td>
      {months.map((m) => {
        const due = report.periods.filter((p) => monthIndex(p.dueDate) === m);
        const planned = scheduled.filter((p) => monthIndex(p.dueDate) === m);
        return (
          <td key={m} className={cx("px-1 py-3 text-center align-top", m === thisMonth && "bg-tint")}>
            <div className="flex flex-col items-center gap-1">
              {due.map((p) => (
                <PeriodPill key={p.id} report={report} period={p} today={today} />
              ))}
              {planned.map((p) => (
                <span
                  key={p.periodStart}
                  title={`${p.label}: due ${formatDay(p.dueDate, today)}. The task will be created on ${formatDay(addDays(p.dueDate, -report.leadDays), today)}.`}
                  className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[0.6875rem] whitespace-nowrap text-slate-500"
                >
                  {shortLabel(report, monthIndex(p.periodStart))}
                </span>
              ))}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

const fmtDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const POPOVER_W = 264;

function PeriodPill({ report, period, today }: { report: Report; period: ReportPeriod; today: string }) {
  // The calendar scrolls sideways, which would clip an absolutely placed popover, so it is placed on screen (fixed).
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const setStatus = useSetPeriodStatus();
  const open = pos !== null;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setPos(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const dismiss = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const toggle = (el: HTMLElement) => {
    if (open) return setPos(null);
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - POPOVER_W / 2), window.innerWidth - POPOVER_W - 8);
    // Open upwards when there isn't room below.
    setPos(r.bottom + 240 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };

  const status = periodStatus(period, today, report.leadDays);
  const s = STATUS[status];
  const submitted = period.status === "submitted";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => toggle(e.currentTarget)}
        aria-expanded={open}
        title={`${period.label}: ${s.label.toLowerCase()}`}
        className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap transition hover:brightness-95 hover:ring-1 hover:ring-current/30 active:scale-90 aria-expanded:ring-2 aria-expanded:ring-brand-500 pointer-coarse:py-1", TONE[s.tone].soft)}
      >
        {submitted ? <Check size={11} strokeWidth={3} /> : <span className={cx("size-1.5 rounded-full", TONE[s.tone].dot)} />}
        {shortLabel(report, monthIndex(period.periodStart))}
      </button>
      {pos && (
        <PopoverCard pos={pos}>
          <p className="font-medium text-ink">
            {report.name} · {period.label}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {fmtDate(period.periodStart)} – {fmtDate(period.periodEnd)}
            <br />
            Due {fmtDate(period.dueDate)}
          </p>
          <p className="mt-2">
            <Badge tone={s.tone}>
              {submitted && period.submittedAt ? `Submitted ${formatDateTime(period.submittedAt)}` : period.dueDate === today ? "Due today" : s.label}
            </Badge>
          </p>
          <Button
            size="sm"
            className="mt-3 w-full"
            variant={submitted ? "secondary" : "primary"}
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: period.id, submitted: !submitted }, { onSuccess: () => setPos(null) })}
          >
            {submitted ? "Mark not submitted" : (<><Check size={15} /> Mark submitted</>)}
          </Button>
          <p className="mt-2 text-[0.6875rem] text-slate-500">Its task is completed or reopened to match.</p>
        </PopoverCard>
      )}
    </div>
  );
}

function PopoverCard({ children, pos }: { children: ReactNode; pos: { left: number; top?: number; bottom?: number } }) {
  return (
    <div style={{ ...pos, width: POPOVER_W }} className="fixed z-40 rounded-xl border border-line bg-white p-3.5 text-left text-sm shadow-xl">
      {children}
    </div>
  );
}
