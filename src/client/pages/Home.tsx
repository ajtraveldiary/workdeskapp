import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock,
  ExternalLink,
  FileText,
  ListChecks,
  ListPlus,
  Mail,
  Plus,
  TriangleAlert,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Category, Task, TaskView, Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import {
  useBulkDismiss,
  useCategories,
  useCompleteTask,
  useDismiss,
  useMarkSeen,
  useReopenTask,
  useRestore,
  useSummary,
  useTasks,
  useThreads,
} from "../api";
import { formatDay, formatTime, formatWhen } from "../format";
import { SnoozeMenu } from "../components/ThreadRow";
import { EmailStatusTags } from "../components/EmailStatus";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { Button, CheckCircle, Menu, PRIORITY_BAR, PriorityPill, Segmented, TONE, cx, type Tone } from "../components/ui";

export function HomePage() {
  const { data: summary, error } = useSummary();
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);

  if (error) return <p className="p-8 text-urgent-ink">{error.message}</p>;
  if (!summary) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  const { counts } = summary;
  const editTask = (task: Task) => setDialog({ kind: "edit", task });

  return (
    <div className="px-4 py-5 md:px-6 lg:px-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {/* Each card is green when its list is clear, and coloured by urgency when it isn't. */}
        <StatCard to="/inbox" icon={Mail} value={counts.pendingEmails} label="Pending emails" note={counts.pendingEmails ? (counts.unreadPending ? `${counts.unreadPending} unread` : "Need your attention") : "All decided"} tone={counts.pendingEmails ? "info" : "low"} />
        <StatCard to="/tasks?view=today" icon={CircleCheck} value={counts.dueToday} label="Tasks due today" note={counts.dueToday ? "Stay on track" : "Nothing due today"} tone={counts.dueToday ? "high" : "low"} />
        <StatCard to="/tasks?view=overdue" icon={TriangleAlert} value={counts.overdue} label="Overdue tasks" note={counts.overdue ? "Needs action" : "All on time"} tone={counts.overdue ? "urgent" : "low"} />
        <StatCard to="/reports" icon={FileText} value={null} label="Upcoming reports" note="Coming soon" tone="info" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <CommandCenter summary={summary} onNew={() => setDialog({ kind: "new" })} onEdit={editTask} />
        <TodoPanel open={counts.openTasks} completed={counts.completedTotal} onEdit={editTask} />
        <EmailsPanel onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })} />
      </div>

      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

// --- Stat cards ---

function StatCard({ to, icon: Icon, value, label, note, tone }: { to: string; icon: LucideIcon; value: number | null; label: string; note: string; tone: Tone }) {
  return (
    <Link to={to} className="group flex flex-col items-start gap-3 rounded-xl border border-line bg-white p-3.5 transition-shadow hover:shadow-[0_8px_24px_-14px_rgb(31_33_48/0.35)] sm:flex-row sm:items-center sm:gap-4 sm:p-4">
      <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-xl shadow-sm sm:size-14", TONE[tone].solid)}>
        <Icon size={26} strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cx("text-2xl leading-none font-semibold tabular-nums sm:text-[28px]", tone === "urgent" ? "text-urgent-ink" : "text-ink")}>
          {value === null ? "—" : String(value).padStart(2, "0")}
        </div>
        <div className="mt-1.5 truncate text-sm font-medium text-ink sm:text-[15px]">{label}</div>
        <div className="truncate text-[13px] text-slate-500">{note}</div>
      </div>
      <ChevronRight size={20} className="hidden shrink-0 text-slate-400 sm:block transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
    </Link>
  );
}

// --- Panels ---

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-h-[420px] flex-col rounded-xl border border-line bg-white xl:h-[calc(100dvh-16.5rem)] xl:min-h-[560px]", className)}>
      {children}
    </section>
  );
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-ink sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const ViewAll = ({ to }: { to: string }) => (
  <Link to={to} className="mt-1 flex shrink-0 items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
    View all <ArrowRight size={15} />
  </Link>
);

function Scroll({ children }: { children: ReactNode }) {
  return <div className="scroll-thin mt-4 min-h-0 flex-1 overflow-y-auto border-t border-line">{children}</div>;
}

function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-low text-white">
        <Icon size={22} />
      </span>
      <p className="mt-3 font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-64 text-sm text-slate-500">{children}</p>}
    </div>
  );
}

const Loading = () => <p className="px-5 py-10 text-center text-sm text-slate-400">Loading…</p>;

// --- Today / Command Center ---

type CommandTab = "today" | "overdue" | "upcoming" | "reports";

function CommandCenter({ summary, onNew, onEdit }: { summary: NonNullable<ReturnType<typeof useSummary>["data"]>; onNew: () => void; onEdit: (t: Task) => void }) {
  const { counts, today } = summary;
  const [tab, setTab] = useState<CommandTab>(counts.dueToday || !counts.overdue ? "today" : "overdue");
  const view: TaskView = tab === "reports" ? "today" : tab;
  const { data } = useTasks({ view });
  const tasks = tab === "reports" ? [] : (data?.tasks ?? []);

  return (
    <Panel className="lg:col-span-2 xl:col-span-1">
      <PanelHeader
        title="Today / Command Center"
        subtitle={new Date(`${today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
        action={
          <Button variant="primary" onClick={onNew}>
            <Plus size={17} /> New task
          </Button>
        }
      />
      <div className="mt-4 px-5">
        <Segmented<CommandTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "today", label: "Today", count: counts.dueToday, tone: "high" },
            { value: "overdue", label: "Overdue", count: counts.overdue, tone: "urgent" },
            { value: "upcoming", label: "Upcoming", count: counts.upcoming, tone: "info" },
            { value: "reports", label: "Reports", count: 0 },
          ]}
        />
      </div>
      <Scroll>
        {tab === "reports" ? (
          <Empty icon={FileText} title="Recurring reports are coming">
            Monthly and annual reports will appear here with their due dates, one task per reporting period.
          </Empty>
        ) : !data ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <Empty icon={CircleCheck} title={tab === "today" ? "Nothing due today" : tab === "overdue" ? "Nothing overdue" : "Nothing scheduled"}>
            {tab === "today" ? "Give a task a due date and it shows up here on the day." : undefined}
          </Empty>
        ) : (
          <ul className="divide-y divide-line px-5">
            {tasks.map((t) => (
              <CommandRow key={t.id} task={t} today={today} onEdit={onEdit} />
            ))}
          </ul>
        )}
      </Scroll>
    </Panel>
  );
}

function subtitleFor(task: Task, categories: Category[]) {
  const firstLine = task.notes.split("\n")[0]?.trim();
  if (firstLine) return firstLine;
  if (task.thread) return `${task.thread.fromName ?? task.thread.fromEmail}: ${task.thread.subject}`;
  return categories.find((c) => c.id === task.categoryId)?.name ?? "";
}

function useTaskActions(task: Task) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const seen = useMarkSeen();
  const done = task.status === "done";
  const gmailUrl = task.thread ? gmailThreadUrl(task.thread.accountEmail, task.thread.gmailThreadId) : null;
  const toggle = () => (done ? reopen.mutate(task.id) : complete.mutate(task.id));
  return { done, toggle, busy: complete.isPending || reopen.isPending, gmailUrl, markSeen: () => task.thread && seen.mutate(task.thread.id) };
}

// Overdue = red, today = orange, later = blue, done or undated = neutral.
function dueTone(task: Task, today: string): Tone {
  if (task.status === "done" || !task.dueDate) return "neutral";
  if (task.dueDate < today) return "urgent";
  if (task.dueDate === today) return "high";
  return "info";
}

function DueChips({ task, today }: { task: Task; today: string }) {
  if (!task.dueDate) return <span className="text-xs text-slate-400">No date</span>;
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <span className={cx("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5", TONE[dueTone(task, today)].soft)}>
        <CalendarDays size={14} className="shrink-0" />
        {formatDay(task.dueDate, today)}
      </span>
      {task.dueTime && (
        <span className="inline-flex items-center gap-1.5 px-1.5 text-slate-600">
          <Clock size={14} className="shrink-0" />
          {formatTime(task.dueTime)}
        </span>
      )}
    </div>
  );
}

function CommandRow({ task, today, onEdit }: { task: Task; today: string; onEdit: (t: Task) => void }) {
  const categories = useCategories().data ?? [];
  const a = useTaskActions(task);
  return (
    <li className="flex items-center gap-3 py-4">
      <CheckCircle checked={a.done} onToggle={a.toggle} disabled={a.busy} label={a.done ? "Reopen task" : "Mark task complete"} />
      <span className={cx("w-[3px] self-stretch rounded-full", PRIORITY_BAR[task.priority])} aria-hidden />
      <button onClick={() => onEdit(task)} className="min-w-0 flex-1 text-left">
        <span className={cx("line-clamp-2 text-[15px] leading-snug font-semibold", a.done ? "text-slate-400 line-through" : "text-ink")}>{task.title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-slate-500">{subtitleFor(task, categories)}</span>
        {task.thread?.hasNewActivity && <span className="mt-1 inline-block rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-800">New reply</span>}
      </button>
      <div className="hidden shrink-0 sm:block">
        <DueChips task={task} today={today} />
      </div>
      <div className="w-16 shrink-0 text-right">
        <PriorityPill priority={task.priority} />
      </div>
      <Menu
        items={[
          { label: "Edit", onClick: () => onEdit(task) },
          { label: a.done ? "Reopen" : "Mark complete", onClick: a.toggle },
          { label: "Open email in Gmail", href: a.gmailUrl ?? undefined, hidden: !a.gmailUrl },
          { label: "Mark reply as seen", onClick: a.markSeen, hidden: !task.thread?.hasNewActivity },
        ]}
      />
    </li>
  );
}

// --- To-do tasks ---

function TodoPanel({ open, completed, onEdit }: { open: number; completed: number; onEdit: (t: Task) => void }) {
  const [tab, setTab] = useState<"all" | "completed">("all");
  const { data } = useTasks({ view: tab });
  const categories = useCategories().data ?? [];
  const tasks = data?.tasks ?? [];

  return (
    <Panel>
      <PanelHeader title="To-do Tasks" action={<ViewAll to="/tasks" />} />
      <div className="mt-4 px-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "My tasks", count: open },
            { value: "completed", label: "Completed", count: completed },
          ]}
        />
      </div>
      <Scroll>
        {!data ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <Empty icon={ListPlus} title={tab === "all" ? "No open tasks" : "Nothing completed yet"} />
        ) : (
          <ul className="divide-y divide-line px-5">
            {tasks.map((t) => (
              <TodoRow key={t.id} task={t} today={data!.today} categories={categories} onEdit={onEdit} />
            ))}
          </ul>
        )}
      </Scroll>
    </Panel>
  );
}

function TodoRow({ task, today, categories, onEdit }: { task: Task; today: string; categories: Category[]; onEdit: (t: Task) => void }) {
  const a = useTaskActions(task);
  const category = categories.find((c) => c.id === task.categoryId)?.name;
  const context = category ?? (task.thread ? (task.thread.fromName ?? task.thread.fromEmail) : "Manual task");

  return (
    <li className="flex gap-3 py-4">
      <div className="pt-0.5">
        <CheckCircle checked={a.done} onToggle={a.toggle} disabled={a.busy} label={a.done ? "Reopen task" : "Mark task complete"} />
      </div>
      <div className="min-w-0 flex-1">
        <button onClick={() => onEdit(task)} className="block max-w-full text-left">
          <span className={cx("line-clamp-2 text-[15px] leading-snug font-semibold", a.done ? "text-slate-400 line-through" : "text-ink")}>{task.title}</span>
          <span className="mt-0.5 block truncate text-[13px] text-slate-500">{context}</span>
        </button>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={cx("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px]", TONE[dueTone(task, today)].soft)}>
            <CalendarDays size={14} />
            {a.done && task.completedAt
              ? `Done ${formatWhen(task.completedAt)}`
              : task.dueDate
                ? `${formatDay(task.dueDate, today)}${task.dueTime ? `, ${formatTime(task.dueTime)}` : ""}`
                : "No date"}
          </span>
          <PriorityPill priority={task.priority} />
        </div>
      </div>
      <Menu
        items={[
          { label: "Edit", onClick: () => onEdit(task) },
          { label: a.done ? "Reopen" : "Mark complete", onClick: a.toggle },
          { label: "Open email in Gmail", href: a.gmailUrl ?? undefined, hidden: !a.gmailUrl },
        ]}
      />
    </li>
  );
}

// --- Emails: pending queue, or every email with its status ---

type EmailTab = "pending" | "all";

function EmailsPanel({ onCreateTask }: { onCreateTask: (t: Thread) => void }) {
  const [tab, setTab] = useState<EmailTab>("pending");
  const { data } = useThreads({ state: tab === "pending" ? "needs_decision" : "all" });
  const bulk = useBulkDismiss();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const threads = data?.threads ?? [];
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  const pending = tab === "pending";
  const live = pending ? [...selected].filter((id) => threads.some((t) => t.id === id)) : [];

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Panel>
      <PanelHeader title={pending ? "Pending Emails" : "All Emails"} action={<ViewAll to={pending ? "/inbox" : "/inbox?state=all"} />} />
      <div className="mt-4 px-5">
        <Segmented<EmailTab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            setSelected(new Set());
          }}
          options={[
            { value: "pending", label: "Pending", count: counts.needs_decision ?? 0 },
            { value: "all", label: "All emails", count: total },
          ]}
        />
      </div>
      {live.length > 0 && (
        <div className="mx-5 mt-3 flex items-center justify-between gap-2 rounded-lg bg-tint px-3 py-2 text-sm">
          <span className="text-brand-800">{live.length} selected</span>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="text-slate-600 hover:underline">
              Clear
            </button>
            <Button size="sm" onClick={() => bulk.mutate(live, { onSuccess: () => setSelected(new Set()) })} disabled={bulk.isPending}>
              Dismiss selected
            </Button>
          </div>
        </div>
      )}
      <Scroll>
        {!data ? (
          <Loading />
        ) : threads.length === 0 ? (
          <Empty icon={Mail} title={pending ? "Every email accounted for" : "No emails yet"}>
            {pending ? "New Gmail messages land here until you make them a task, snooze them, or dismiss them." : "Emails appear here after the first sync."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line px-5">
            {threads.map((t) => (
              <EmailCard
                key={t.id}
                thread={t}
                showStatus={!pending}
                selected={selected.has(t.id)}
                onSelect={pending ? (on) => toggle(t.id, on) : undefined}
                onCreateTask={onCreateTask}
              />
            ))}
          </ul>
        )}
      </Scroll>
    </Panel>
  );
}

function EmailCard({
  thread,
  showStatus,
  selected,
  onSelect,
  onCreateTask,
}: {
  thread: Thread;
  showStatus: boolean;
  selected: boolean;
  onSelect?: (on: boolean) => void;
  onCreateTask: (t: Thread) => void;
}) {
  const dismiss = useDismiss();
  const restore = useRestore();
  const gmailUrl = gmailThreadUrl(thread.accountEmail, thread.gmailThreadId);
  const inQueue = thread.state === "needs_decision";
  return (
    <li className={cx("-mx-5 flex gap-3 px-5 py-4", selected && "bg-tint")}>
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select email from ${thread.fromName ?? thread.fromEmail}`}
          className="mt-1 size-[18px] shrink-0 accent-brand-600"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {thread.unread && <span className="size-2 shrink-0 -translate-y-px rounded-full bg-brand-600" title="Unread in Gmail" />}
          <span className={cx("truncate text-sm", thread.unread ? "font-semibold text-ink" : "font-medium text-slate-800")}>
            {thread.fromName ?? thread.fromEmail ?? "Unknown sender"}
          </span>
          {thread.messageCount > 1 && <span className="text-xs text-slate-400">({thread.messageCount})</span>}
          <span className="ml-auto shrink-0 text-xs text-slate-500">{formatWhen(thread.lastMessageAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-ink">{thread.subject}</p>
        {showStatus && <EmailStatusTags thread={thread} className="mt-1.5" />}
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-slate-500">{thread.snippet}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {inQueue ? (
            <>
              <Button size="sm" onClick={() => onCreateTask(thread)}>
                <ListPlus size={15} /> Create task
              </Button>
              <SnoozeMenu id={thread.id} compact />
              <Button size="sm" onClick={() => dismiss.mutate(thread.id)} disabled={dismiss.isPending} title="Remove from the queue. Gmail is not changed.">
                <X size={15} /> Dismiss
              </Button>
            </>
          ) : thread.state === "task" ? (
            <Link to={`/search?q=${encodeURIComponent(thread.subject)}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-slate-700 hover:border-slate-300">
              <ListChecks size={15} /> View task
            </Link>
          ) : (
            <Button size="sm" onClick={() => restore.mutate(thread.id)} disabled={restore.isPending}>
              <Undo2 size={15} /> Return to pending
            </Button>
          )}
          {gmailUrl && (
            <a href={gmailUrl} target="_blank" rel="noreferrer" className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink" title="Open in Gmail" aria-label="Open in Gmail">
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
