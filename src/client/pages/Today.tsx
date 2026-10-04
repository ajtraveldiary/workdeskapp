import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Plus } from "lucide-react";
import type { Task, Thread } from "../../shared/types";
import { useCategories, useSummary } from "../api";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { TaskRow } from "../components/TaskRow";
import { ThreadRow } from "../components/ThreadRow";
import { Button, Card, Empty, PageHeader, cx } from "../components/ui";

export function TodayPage() {
  const { data, error } = useSummary();
  const categories = useCategories().data ?? [];
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  if (error) return <p className="text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { counts, today } = data;
  const allClear = counts.pendingEmails + counts.overdue + counts.dueToday + counts.newActivity === 0;

  const taskList = (tasks: Task[]) => (
    <ul className="divide-y divide-slate-100">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} today={today} categories={categories} onEdit={(task) => setDialog({ kind: "edit", task })} />
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={new Date(`${today}T00:00:00Z`).toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        })}
        actions={
          <Button variant="primary" onClick={() => setDialog({ kind: "new" })}>
            <Plus size={16} /> New task
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat to="/inbox" label="Emails awaiting decision" value={counts.pendingEmails} note={counts.unreadPending ? `${counts.unreadPending} unread` : undefined} />
        <Stat to="/tasks?view=overdue" label="Overdue tasks" value={counts.overdue} alert={counts.overdue > 0} />
        <Stat to="/tasks?view=today" label="Due today" value={counts.dueToday} />
        <Stat to="/tasks?view=upcoming" label="Due tomorrow" value={counts.dueTomorrow} note={`${counts.completedThisWeek} done this week`} />
      </div>

      {allClear && (
        <Card className="mb-6">
          <Empty title="All clear">No emails waiting for a decision and nothing overdue or due today.</Empty>
        </Card>
      )}

      <div className="space-y-6">
        {data.overdue.length > 0 && <Section title="Overdue" tone="red">{taskList(data.overdue)}</Section>}
        {data.dueToday.length > 0 && <Section title="Due today">{taskList(data.dueToday)}</Section>}
        {data.newActivity.length > 0 && <Section title="New replies on open tasks">{taskList(data.newActivity)}</Section>}
        {data.pendingEmails.length > 0 && (
          <Section
            title="Emails awaiting a decision"
            action={
              counts.pendingEmails > data.pendingEmails.length && (
                <Link to="/inbox" className="text-sm font-medium text-brand-700 hover:underline">
                  View all {counts.pendingEmails}
                </Link>
              )
            }
          >
            <ul className="divide-y divide-slate-100">
              {data.pendingEmails.map((t: Thread) => (
                <ThreadRow key={t.id} thread={t} categories={categories} onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })} />
              ))}
            </ul>
          </Section>
        )}
        {data.dueTomorrow.length > 0 && <Section title="Due tomorrow">{taskList(data.dueTomorrow)}</Section>}
        {data.recentlyCompleted.length > 0 && <Section title="Recently completed">{taskList(data.recentlyCompleted)}</Section>}
      </div>

      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function Stat({ to, label, value, note, alert }: { to: string; label: string; value: number; note?: string; alert?: boolean }) {
  return (
    <Link
      to={to}
      className={cx(
        "rounded-lg border bg-white px-4 py-3 transition-colors hover:border-slate-300",
        alert ? "border-red-200" : "border-slate-200",
      )}
    >
      <div className={cx("text-2xl font-semibold tabular-nums", alert ? "text-red-700" : "text-slate-900")}>{value}</div>
      <div className="text-sm text-slate-600">{label}</div>
      {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
    </Link>
  );
}

function Section({ title, children, tone, action }: { title: string; children: ReactNode; tone?: "red"; action?: ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className={cx("text-sm font-semibold", tone === "red" ? "text-red-700" : "text-slate-700")}>{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
