// Reminders (formerly Reports, user request 2026-10-06): monthly reports, meetings, payment due dates...
// Each occurrence gets its own task ahead of its date; marking either done updates the other.
import { useState } from "react";
import { CalendarClock, CircleCheck, Clock, Plus, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Report, ReportPeriod } from "../../shared/types";
import { dayLabel, nextOccurrence, remindLabel, repeatText } from "../../shared/reminderSchedule";
import { useDeleteReport, useReports, useSetPeriodStatus, useUpdateReport } from "../api";
import { addDays, formatDay, formatTime } from "../format";
import { ReminderDialog, type ReminderDialogMode } from "../components/ReminderDialog";
import { Badge, Button, Card, CheckCircle, Loading, Menu, PageHeader, TONE, cx, type Tone } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

export function RemindersPage() {
  const { data, error } = useReports();
  const [dialog, setDialog] = useState<ReminderDialogMode | null>(null);

  if (error) return <p className="text-urgent-ink">{error.message}</p>;
  if (!data) return <Loading className="py-24" />;
  const { reports, today } = data;

  const pending = reports.flatMap((r) => r.periods.filter((p) => p.status === "pending").map((p) => ({ report: r, period: p })));
  const overdue = pending.filter((x) => x.period.dueDate < today);
  const next30 = pending.filter((x) => x.period.dueDate >= today && x.period.dueDate <= addDays(today, 30));
  const doneThisMonth = reports.flatMap((r) => r.periods).filter((p) => p.submittedAt && p.submittedAt.slice(0, 7) === today.slice(0, 7)).length;
  const dueNext = [...overdue, ...next30].sort((a, b) => a.period.dueDate.localeCompare(b.period.dueDate) || (a.report.dueTime ?? "").localeCompare(b.report.dueTime ?? ""));

  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle="Monthly reports, meetings, payment due dates and anything else that comes round again. Each one gets its own task before it is due."
        actions={
          <>
            <RefreshButton keys={[["reports"], ["summary"], ["tasks"]]} label="Refresh reminders" />
            <Button variant="primary" onClick={() => setDialog({ kind: "new" })}>
              <Plus size={17} /> New reminder
            </Button>
          </>
        }
      />

      {reports.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-info text-white">
            <CalendarClock size={22} />
          </span>
          <p className="mt-3 font-medium text-ink">No reminders yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Add things like the monthly HMIS report, a weekly staff meeting or the electricity bill. WorkDesk creates a task before each one is due.
          </p>
          <Button variant="primary" className="mt-4" onClick={() => setDialog({ kind: "new" })}>
            <Plus size={17} /> Add your first reminder
          </Button>
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Tile icon={TriangleAlert} value={overdue.length} label="Overdue" tone={overdue.length ? "urgent" : "low"} />
            <Tile icon={Clock} value={next30.length} label="Due in 30 days" tone={next30.length ? "high" : "low"} />
            <Tile icon={CircleCheck} value={doneThisMonth} label="Done this month" tone="low" />
          </div>

          <Card>
            <h2 className="border-b border-line px-4 py-3 text-headline font-semibold text-ink sm:px-5 sm:py-3.5">Due next</h2>
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

          <Card>
            <h2 className="border-b border-line px-4 py-3 text-headline font-semibold text-ink sm:px-5 sm:py-3.5">All reminders</h2>
            <ul className="divide-y divide-line">
              {reports.map((r) => (
                <ReminderRow key={r.id} report={r} today={today} onEdit={() => setDialog({ kind: "edit", report: r })} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      <ReminderDialog mode={dialog} onClose={() => setDialog(null)} />
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
        <div className="mt-1 text-caption2 leading-tight font-medium text-ink sm:text-footnote sm:leading-snug">{label}</div>
      </div>
    </div>
  );
}

function DueRow({ report, period, today }: { report: Report; period: ReportPeriod; today: string }) {
  const setStatus = useSetPeriodStatus();
  const late = period.dueDate < today;
  const tone: Tone = late ? "urgent" : period.dueDate <= addDays(today, Math.max(report.leadDays, 7)) ? "high" : "info";
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      {/* A tick circle like tasks, instead of a "Done" button on every row (user request 2026-10-06). */}
      <CheckCircle checked={false} onToggle={() => setStatus.mutate({ id: period.id, submitted: true })} disabled={setStatus.isPending} label={`Mark done: ${report.name}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-subhead font-medium text-ink">{report.name}</p>
        <p className={cx("flex min-w-0 items-center gap-1.5 truncate text-footnote", late ? "text-urgent-ink" : "text-slate-500")}>
          <span className={cx("size-2 shrink-0 rounded-full", TONE[tone].dot)} aria-hidden />
          {late ? `Overdue · was due ${formatDay(period.dueDate, today)}` : formatDay(period.dueDate, today)}
          {report.dueTime && ` · ${formatTime(report.dueTime)}`}
          {/* Old report periods say which month they cover ("Sep 2026"); newer labels are just the date. */}
          {period.label !== dayLabel(period.dueDate) && <span className="text-slate-400"> · {period.label}</span>}
        </p>
      </div>
    </li>
  );
}

function ReminderRow({ report, today, onEdit }: { report: Report; today: string; onEdit: () => void }) {
  const update = useUpdateReport();
  const remove = useDeleteReport();
  const next = report.active ? nextOccurrence(report, today) : null;
  const details = [repeatText(report), report.dueTime && formatTime(report.dueTime), report.leadDays > 0 && `remind ${remindLabel(report.leadDays)}`].filter(Boolean).join(" · ");

  return (
    <li className={cx("row-click flex items-start gap-3 px-4 py-3 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5", !report.active && "opacity-60")}>
      <button onClick={onEdit} className="row-link group/title min-w-0 flex-1 text-left">
        <p className="text-subhead font-medium text-ink group-hover/title:text-brand-700">{report.name}</p>
        <p className="text-footnote text-slate-500">{details}</p>
        <p className="mt-0.5 text-footnote text-slate-500">
          {!report.active ? <Badge>Paused</Badge> : next ? <>Next: <span className="font-medium text-ink">{formatDay(next, today)}</span></> : "No more dates"}
        </p>
      </button>
      <Menu
        items={[
          { label: "Edit", onClick: onEdit },
          { label: report.active ? "Pause" : "Resume", onClick: () => update.mutate({ id: report.id, input: { active: !report.active } }) },
          {
            label: "Delete",
            onClick: () => confirm(`Delete "${report.name}"? Its open tasks are removed. Completed tasks stay in History.`) && remove.mutate(report.id),
          },
        ]}
      />
    </li>
  );
}
