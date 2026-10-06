import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  AlarmClock,
  CalendarClock,
  ArrowRight,
  CalendarDays,
  Check,
  Eye,
  CircleCheck,
  ExternalLink,
  ListChecks,
  ListPlus,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  TriangleAlert,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Task, TaskView, Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import {
  useCompleteTask,
  useDismiss,
  useMarkSeen,
  useReopenTask,
  useRestore,
  useSummary,
  useTasks,
  useThread,
  useThreads,
} from "../api";
import { formatDay, formatTime, formatWhen } from "../format";
import { SnoozeSheet } from "../components/ThreadRow";
import { SwipeRow, showUndo, useSwipeMode, type SwipeAction } from "../components/SwipeRow";
import { EmailStatusTags } from "../components/EmailStatus";
import { LabelChips } from "../components/LabelChips";
import { EmailViewer } from "../components/EmailViewer";
import { EmailBulkBar } from "../components/EmailBulkBar";
import { PriorityGrouped } from "../components/PriorityGroups";
import { TaskDetails } from "../components/TaskDetails";
import { EditableDue, dueTone } from "../components/InlineTaskEdit";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { Button, CheckCircle, Loading as PageLoading, Menu, PRIORITY_BAR, Segmented, SkeletonList, Spinner, TONE, cx, type Tone } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

export function HomePage() {
  const { data: summary, error } = useSummary();
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);

  if (error) return <p className="p-8 text-urgent-ink">{error.message}</p>;
  if (!summary) return <PageLoading className="py-24" />;
  const { counts } = summary;
  const editTask = (task: Task) => setDialog({ kind: "edit", task });

  return (
    <>
    {/* Wide screens: stat cards + task panels on the left, Pending Emails full height on the right. The compact
        Command Center is the narrower task panel and Pending Emails gets more room (user request 2026-10-06). */}
    <div className="px-3 py-3 sm:px-4 sm:py-5 md:px-6 lg:px-8 xl:grid xl:h-[calc(100dvh-5rem-1px)] xl:min-h-[680px] xl:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)] xl:gap-5">
      <div className="flex min-h-0 flex-col gap-3 md:gap-5">
      {/* Phones: one compact row of four; small tablets: 2x2; wide: one row */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        {/* Each card is green when its list is clear, and coloured by urgency when it isn't. */}
        <StatCard to="/inbox" icon={Mail} value={counts.pendingEmails} label="Pending emails" note={counts.pendingEmails ? (counts.unreadPending ? `${counts.unreadPending} unread` : "Need your attention") : "All decided"} tone={counts.pendingEmails ? "info" : "low"} />
        <StatCard to="/tasks?view=today" icon={CircleCheck} value={counts.dueToday} label="Tasks due today" note={counts.dueToday ? "Stay on track" : "Nothing due today"} tone={counts.dueToday ? "high" : "low"} />
        <StatCard to="/tasks?view=overdue" icon={TriangleAlert} value={counts.overdue} label="Overdue tasks" note={counts.overdue ? "Needs action" : "All on time"} tone={counts.overdue ? "urgent" : "low"} />
        <StatCard
          to="/reminders"
          icon={CalendarClock}
          value={counts.reportsUpcoming + counts.reportsOverdue}
          label="Reminders"
          note={counts.reportsOverdue ? `${counts.reportsOverdue} overdue` : counts.reportsUpcoming ? "Next 30 days" : "Nothing due soon"}
          tone={counts.reportsOverdue ? "urgent" : counts.reportsUpcoming ? "info" : "low"}
        />
      </div>

      {/* Phones show only the Today list (user request 2026-10-06): no panel switcher. To-do and Pending emails
          are the Tasks and Emails tabs of the bottom bar; refresh is the sync button in the top bar. */}
      <button
        onClick={() => setDialog({ kind: "new" })}
        aria-label="New task"
        title="New task"
        className="fixed right-4 bottom-[calc(var(--tabbar-h)+1rem+env(safe-area-inset-bottom))] z-30 flex size-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 active:scale-90 md:hidden"
      >
        <Plus size={24} />
      </button>

      <div className="grid min-h-0 grid-cols-1 gap-3 md:gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] xl:flex-1">
        <CommandCenter summary={summary} onNew={() => setDialog({ kind: "new" })} onEdit={editTask} onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })} />
        <TodoPanel
          open={counts.openTasks}
          completed={counts.completedTotal}
          onEdit={editTask}
          onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })}
          hiddenOnPhone
        />
      </div>
      </div>

      <div className="mt-3 min-h-0 max-md:hidden md:mt-5 xl:mt-0">
        <EmailsPanel onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })} />
      </div>
    </div>

    <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}


// --- Stat cards ---

function StatCard({ to, icon: Icon, value, label, note, tone }: { to: string; icon: LucideIcon; value: number | null; label: string; note: string; tone: Tone }) {
  return (
    <Link
      to={to}
      className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-line bg-white p-2.5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_24px_-14px_rgb(31_33_48/0.35)] active:translate-y-0 active:scale-[0.98] sm:flex-row sm:items-center sm:gap-2.5 sm:px-3 sm:py-3"
    >
      <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-md shadow-sm sm:size-10 sm:rounded-lg", TONE[tone].solid)}>
        <Icon strokeWidth={1.8} className="size-4 sm:size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cx("text-lg leading-none font-semibold tabular-nums sm:text-2xl", tone === "urgent" ? "text-urgent-ink" : "text-ink")}>
            {value === null ? "—" : String(value).padStart(2, "0")}
          </span>
        </div>
        <div className="mt-1 line-clamp-2 text-[0.6875rem] leading-tight font-medium text-ink sm:text-[0.8125rem] sm:leading-snug">{label}</div>
        <div className="hidden truncate text-xs text-slate-500 sm:block">{note}</div>
      </div>
    </Link>
  );
}

// --- Panels ---

function Panel({ children, className, hiddenOnPhone }: { children: ReactNode; className?: string; hiddenOnPhone?: boolean }) {
  return (
    <section className={cx("flex flex-col rounded-xl border border-line bg-white md:min-h-[420px] xl:h-full xl:min-h-0", hiddenOnPhone && "max-md:hidden", className)}>
      {children}
    </section>
  );
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    // Wraps on narrow screens so the buttons drop below the title instead of squeezing it.
    // Hidden on phones: the switcher above names the panel and the buttons sit on the tabs row (TabsRow).
    <div className="flex flex-wrap items-start justify-between gap-3 px-3 pt-3 max-md:hidden sm:px-5 sm:pt-5">
      <div className="min-w-0 flex-1 basis-52">
        <h2 className="text-lg font-semibold text-ink sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// A panel's tabs, plus (on phones only) the panel's buttons on the same row.
function TabsRow({ children, mobileActions }: { children: ReactNode; mobileActions: ReactNode }) {
  return (
    <div className="mt-3 flex items-center gap-2 px-3 sm:mt-4 sm:px-5">
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      <div className="flex shrink-0 items-center gap-2 md:hidden">{mobileActions}</div>
    </div>
  );
}

const ViewAll = ({ to }: { to: string }) => (
  <Link to={to} className="group/va mt-1 flex shrink-0 items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
    View all <ArrowRight size={15} className="transition-transform group-hover/va:translate-x-0.5" />
  </Link>
);

function Scroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line sm:mt-4", className)}>{children}</div>;
}

function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center sm:py-14">
      <span className="flex size-12 items-center justify-center rounded-full bg-low text-white">
        <Icon size={22} />
      </span>
      <p className="mt-3 font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-64 text-sm text-slate-500">{children}</p>}
    </div>
  );
}

const Loading = () => <SkeletonList />;

// --- Today / Command Center ---

type CommandTab = "today" | "overdue" | "upcoming" | "reports";

// Phones (below Tailwind's md, where the bottom navigation shows).
const PHONE_WIDTH = "(max-width: 767.98px)";
function usePhoneWidth() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE_WIDTH);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_WIDTH).matches,
    () => false,
  );
}

function CommandCenter({
  summary,
  onNew,
  onEdit,
  onCreateTask,
  hiddenOnPhone,
}: {
  summary: NonNullable<ReturnType<typeof useSummary>["data"]>;
  onNew: () => void;
  onEdit: (t: Task) => void;
  onCreateTask: (t: Thread) => void;
  hiddenOnPhone?: boolean;
}) {
  const { counts, today } = summary;
  // Tapping a task or reminder opens its details card (user request 2026-10-06); the card can open the email.
  const [emailId, setEmailId] = useState<string | null>(null);
  const [details, setDetails] = useState<Task | null>(null);
  const email = useThread(emailId).data ?? null;
  const openTask = (t: Task) => setDetails(t);
  const [tab, setTab] = useState<CommandTab>(counts.dueToday || !counts.overdue ? "today" : "overdue");
  const view: TaskView = tab;
  // Phones have no tabs (user request 2026-10-06): one list, overdue first, then today. Wider screens use
  // the tabs; there both calls share the tab's query, so nothing extra is fetched.
  const phone = usePhoneWidth();
  const main = useTasks({ view: phone ? "today" : view });
  const late = useTasks({ view: phone ? "overdue" : view });
  const data = phone ? (main.data && late.data ? { ...main.data, tasks: [...late.data.tasks, ...main.data.tasks] } : undefined) : main.data;
  const tasks = data?.tasks ?? [];

  return (
    <Panel hiddenOnPhone={hiddenOnPhone}>
      <PanelHeader
        title="Today / Command Center"
        subtitle={new Date(`${today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <RefreshButton keys={[["tasks"], ["summary"]]} label="Refresh Command Center" />
            <Button variant="primary" onClick={onNew}>
              <Plus size={17} /> New task
            </Button>
          </div>
        }
      />
      {!phone && (
      <TabsRow
        mobileActions={
          <>
          <RefreshButton keys={[["tasks"], ["summary"]]} label="Refresh Command Center" />
          <Button size="sm" variant="primary" onClick={onNew} aria-label="New task" className="w-9 px-0!">
            <Plus size={17} />
          </Button>
          </>
        }
      >
        <Segmented<CommandTab>
          oneRow
          value={tab}
          onChange={setTab}
          options={[
            { value: "today", label: "Today", count: counts.dueToday, tone: "high" },
            { value: "overdue", label: "Overdue", count: counts.overdue, tone: "urgent" },
            { value: "upcoming", label: "Upcoming", count: counts.upcoming, tone: "info" },
            { value: "reports", label: "Reminders", count: counts.reportTasks },
          ]}
        />
      </TabsRow>
      )}
      {/* Phones: no tabs row above, so the list starts at the top of the panel */}
      <Scroll className="max-md:mt-0 max-md:border-t-0">
        {!data ? (
          <Loading />
        ) : tasks.length === 0 && tab === "reports" ? (
          <Empty icon={CalendarClock} title="No reminder tasks open">
            Each reminder's task appears here ahead of its date. <Link to="/reminders" className="font-medium text-brand-700 hover:underline">Set up reminders</Link>
          </Empty>
        ) : tasks.length === 0 ? (
          <Empty icon={CircleCheck} title={phone ? "Nothing due today or overdue" : tab === "today" ? "Nothing due today" : tab === "overdue" ? "Nothing overdue" : "Nothing scheduled"}>
            {phone || tab === "today" ? "Give a task a due date and it shows up here on the day." : undefined}
          </Empty>
        ) : (
          <ul className="@container divide-y divide-line px-3 sm:px-5">
            <PriorityGrouped tasks={tasks}>
              {(t) => <CommandRow key={t.id} task={t} today={today} onEdit={onEdit} onOpen={openTask} />}
            </PriorityGrouped>
          </ul>
        )}
      </Scroll>
      <EmailViewer
        thread={emailId ? email : null}
        onClose={() => setEmailId(null)}
        onCreateTask={(thread) => {
          setEmailId(null);
          onCreateTask(thread);
        }}
      />
      <TaskDetails
        task={details}
        onOpenEmail={(id) => {
          setDetails(null);
          setEmailId(id);
        }}
        onClose={() => setDetails(null)}
        onEdit={(t) => {
          setDetails(null);
          onEdit(t);
        }}
      />
    </Panel>
  );
}

function useTaskActions(task: Task) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const seen = useMarkSeen();
  const done = task.status === "done";
  const gmailUrl = task.thread ? gmailThreadUrl(task.thread.accountEmail, task.thread.gmailThreadId) : null;
  const toggle = () => (done ? reopen.mutate(task.id) : complete.mutate(task.id));
  const toggleAsync = () => (done ? reopen.mutateAsync(task.id) : complete.mutateAsync(task.id));
  return { done, toggle, toggleAsync, busy: complete.isPending || reopen.isPending, gmailUrl, markSeen: () => task.thread && seen.mutate(task.thread.id) };
}

// Phones: swipe right to complete (or reopen), left for Gmail / seen / edit.
function taskSwipe(task: Task, a: ReturnType<typeof useTaskActions>, onEdit: (t: Task) => void): { leading: SwipeAction; trailing: SwipeAction[] } {
  return {
    leading: a.done
      ? { label: "Reopen", icon: RotateCcw, tone: "neutral", onClick: a.toggleAsync }
      : { label: "Done", icon: Check, tone: "low", onClick: () => a.toggleAsync().then(() => showUndo({ message: "Task completed", undo: { kind: "reopen", id: task.id } })) },
    trailing: [
      { label: "Gmail", icon: ExternalLink, tone: "info", href: a.gmailUrl ?? undefined, hidden: !a.gmailUrl },
      { label: "Seen", icon: Eye, tone: "brand", onClick: a.markSeen, hidden: !task.thread?.hasNewActivity || a.done },
      { label: "Edit", icon: Pencil, tone: "neutral", onClick: () => onEdit(task) },
    ],
  };
}

// Today / Command Center rows (user request 2026-10-06): one compact line, a link to the task or reminder;
// tapping opens its details card. No sender, tick circle or menu (phones still swipe to complete or edit).
function CommandRow({ task, today, onEdit, onOpen }: { task: Task; today: string; onEdit: (t: Task) => void; onOpen: (t: Task) => void }) {
  const a = useTaskActions(task);
  const late = !!task.dueDate && task.dueDate < today;
  const when = [task.dueDate && task.dueDate !== today ? formatDay(task.dueDate, today) : null, task.dueTime && formatTime(task.dueTime)].filter(Boolean).join(", ");
  return (
    <SwipeRow
      className="-mx-3 sm:-mx-5"
      contentClassName="flex items-center gap-2.5 px-3 py-2 transition-colors has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5"
      {...taskSwipe(task, a, onEdit)}
    >
      <span className={cx("h-4 w-[3px] shrink-0 rounded-full", PRIORITY_BAR[task.priority])} aria-hidden />
      <button
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 truncate text-left text-[0.8125rem] font-medium text-ink hover:text-brand-700 hover:underline sm:text-sm"
        aria-label={`Show details: ${task.title}`}
      >
        {task.report && <CalendarClock size={13} className="mr-1 inline -translate-y-px text-slate-400" aria-label="Reminder" />}
        {task.title}
      </button>
      {when && <span className={cx("shrink-0 text-xs tabular-nums", late ? "font-medium text-urgent-ink" : "text-slate-500")}>{when}</span>}
    </SwipeRow>
  );
}

// --- To-do tasks ---

function TodoPanel({
  open,
  completed,
  onEdit,
  onCreateTask,
  hiddenOnPhone,
}: {
  open: number;
  completed: number;
  onEdit: (t: Task) => void;
  onCreateTask: (t: Thread) => void;
  hiddenOnPhone?: boolean;
}) {
  const [tab, setTab] = useState<"all" | "completed">("all");
  // Tapping a task opens the email it came from, or (for tasks made by hand) its details.
  const [emailId, setEmailId] = useState<string | null>(null);
  const [details, setDetails] = useState<Task | null>(null);
  const email = useThread(emailId).data ?? null;
  const openTask = (t: Task) => (t.thread ? setEmailId(t.thread.id) : setDetails(t));
  const { data } = useTasks({ view: tab });
  const tasks = data?.tasks ?? [];

  return (
    <Panel hiddenOnPhone={hiddenOnPhone}>
      <PanelHeader
        title="To-do Tasks"
        action={
          <div className="flex shrink-0 items-center gap-3">
            <ViewAll to="/tasks" />
            <RefreshButton keys={[["tasks"], ["summary"]]} label="Refresh to-do list" />
          </div>
        }
      />
      <TabsRow
        mobileActions={
          <>
          <RefreshButton keys={[["tasks"], ["summary"]]} label="Refresh to-do list" />
          </>
        }
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "My tasks", count: open },
            { value: "completed", label: "Completed", count: completed },
          ]}
        />
      </TabsRow>
      <Scroll>
        {!data ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <Empty icon={ListPlus} title={tab === "all" ? "No open tasks" : "Nothing completed yet"} />
        ) : (
          <ul className="divide-y divide-line px-3 sm:px-5">
            {tab === "all" ? (
              <PriorityGrouped tasks={tasks}>
                {(t) => <TodoRow key={t.id} task={t} today={data!.today} onEdit={onEdit} onOpen={openTask} />}
              </PriorityGrouped>
            ) : (
              tasks.map((t) => <TodoRow key={t.id} task={t} today={data!.today} onEdit={onEdit} onOpen={openTask} />)
            )}
          </ul>
        )}
      </Scroll>
      <EmailViewer
        thread={emailId ? email : null}
        onClose={() => setEmailId(null)}
        onCreateTask={(thread) => {
          setEmailId(null);
          onCreateTask(thread);
        }}
      />
      <TaskDetails
        task={details}
        onClose={() => setDetails(null)}
        onEdit={(t) => {
          setDetails(null);
          onEdit(t);
        }}
      />
    </Panel>
  );
}

function TodoRow({
  task,
  today,
  onEdit,
  onOpen,
}: {
  task: Task;
  today: string;
  onEdit: (t: Task) => void;
  onOpen: (t: Task) => void;
}) {
  const a = useTaskActions(task);
  const context = task.thread ? (task.thread.fromName ?? task.thread.fromEmail) : task.report ? "Reminder" : "Manual task";
  const swipe = useSwipeMode();

  return (
    <SwipeRow
      className="-mx-3 sm:-mx-5"
      contentClassName="flex gap-3 px-3 py-3 transition-colors has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5 sm:py-4"
      {...taskSwipe(task, a, onEdit)}
    >
      {!swipe && (
        <div className="pt-0.5">
          <CheckCircle checked={a.done} onToggle={a.toggle} disabled={a.busy} label={a.done ? "Reopen task" : "Mark task complete"} />
        </div>
      )}
      <span className={cx("w-[3px] self-stretch rounded-full", PRIORITY_BAR[task.priority], a.done && "opacity-40")} aria-hidden />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onOpen(task)}
          className="group/title block max-w-full text-left"
          aria-label={task.thread ? `Open the email for: ${task.title}` : `Show details: ${task.title}`}
        >
          <span className={cx("line-clamp-2 text-[0.8125rem] leading-snug font-semibold sm:text-sm", a.done ? "text-slate-400 line-through" : "text-ink group-hover/title:text-brand-700")}>{task.title}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 sm:text-[0.8125rem]">{context}</span>
        </button>
        <div className="mt-1.5 flex items-center justify-between gap-2 sm:mt-2">
          {a.done ? (
            <>
              <span className={cx("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap sm:text-[0.8125rem]", TONE[dueTone(task, today)].soft)}>
                <CalendarDays size={14} />
                {task.completedAt ? `Done ${formatWhen(task.completedAt)}` : "Done"}
              </span>
            </>
          ) : (
            <EditableDue task={task} today={today} layout="joined" />
          )}
        </div>
      </div>
      {!swipe && (
        <Menu
          items={[
            { label: "Edit", onClick: () => onEdit(task) },
            { label: a.done ? "Reopen" : "Mark complete", onClick: a.toggle },
            { label: "Open email in Gmail", href: a.gmailUrl ?? undefined, hidden: !a.gmailUrl },
          ]}
        />
      )}
    </SwipeRow>
  );
}

// --- Emails: pending queue, or every email with its status ---

type EmailTab = "pending" | "all";
const ALL_PAGE = 100;

function EmailsPanel({ onCreateTask }: { onCreateTask: (t: Thread) => void }) {
  const [tab, setTab] = useState<EmailTab>("pending");
  // All emails loads in pages of ALL_PAGE (a full 300 at once can be too heavy for the server).
  const [limit, setLimit] = useState(ALL_PAGE);
  const { data, error, isFetching, isPlaceholderData, refetch } = useThreads(
    tab === "pending" ? { state: "needs_decision" } : { state: "all", limit },
  );
  // While the other tab's list is still on screen as a placeholder, show "Loading…" instead of it.
  const shownTab = useRef(tab);
  if (data && !isPlaceholderData) shownTab.current = tab;
  const waiting = !data || (isPlaceholderData && shownTab.current !== tab);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<Thread | null>(null);
  const threads = data?.threads ?? [];
  const counts = data?.counts ?? {};
  const hidden = data?.hiddenPending ?? 0;
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0) + hidden;
  const pending = tab === "pending";

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Panel>
      <PanelHeader
        title={pending ? "Pending Emails" : "All Emails"}
        action={
          <div className="flex shrink-0 items-center gap-3">
            <ViewAll to={pending ? "/inbox" : "/inbox?state=all"} />
            <RefreshButton keys={[["threads"], ["summary"]]} sync label="Check Gmail and refresh emails" />
          </div>
        }
      />
      <TabsRow
        mobileActions={
          <>
          <RefreshButton keys={[["threads"], ["summary"]]} sync label="Check Gmail and refresh emails" />
          </>
        }
      >
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
      </TabsRow>
      {/* One toolbar for the list instead of buttons on every email (user request 2026-10-06). */}
      {!waiting && <EmailBulkBar threads={threads} selected={selected} onSelectedChange={setSelected} onCreateTask={onCreateTask} className="px-3 pt-2.5 sm:px-5" />}
      <Scroll>
        {error && !isFetching ? (
          <div className="px-5 py-10 text-center text-sm">
            <p className="text-urgent-ink">Couldn't load {pending ? "pending" : "all"} emails: {error.message}</p>
            <Button size="sm" className="mt-3" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : waiting ? (
          <Loading />
        ) : threads.length === 0 ? (
          <Empty icon={Mail} title={pending ? "Every email accounted for" : "No emails yet"}>
            {pending ? "New Gmail messages land here until you make them a task, snooze them, or dismiss them." : "Emails appear here after the first sync."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line px-3 sm:px-5">
            {threads.map((t) => (
              <EmailCard
                key={t.id}
                thread={t}
                showStatus={!pending}
                selected={selected.has(t.id)}
                onSelect={(on) => toggle(t.id, on)}
                onCreateTask={onCreateTask}
                onOpen={setViewing}
              />
            ))}
            {!pending && threads.length >= limit && (
              <li className="py-3 text-center">
                <Button size="sm" onClick={() => setLimit((n) => n + ALL_PAGE)} disabled={isFetching}>
                  {isFetching ? <><Spinner size={14} /> Loading…</> : "Show more"}
                </Button>
              </li>
            )}
          </ul>
        )}
      </Scroll>
      <EmailViewer
        thread={viewing}
        onClose={() => setViewing(null)}
        onCreateTask={(t) => {
          setViewing(null);
          onCreateTask(t);
        }}
      />
    </Panel>
  );
}

function EmailCard({
  thread,
  showStatus,
  selected,
  onSelect,
  onCreateTask,
  onOpen,
}: {
  thread: Thread;
  showStatus: boolean;
  selected: boolean;
  onSelect?: (on: boolean) => void;
  onCreateTask: (t: Thread) => void;
  onOpen: (t: Thread) => void;
}) {
  const dismiss = useDismiss();
  const restore = useRestore();
  const gmailUrl = gmailThreadUrl(thread.accountEmail, thread.gmailThreadId);
  const inQueue = thread.state === "needs_decision";
  // Phones: swipe right to make a task (or restore), left for Gmail / snooze / dismiss; the button bar goes away.
  const swipe = useSwipeMode();
  const navigate = useNavigate();
  const [snoozing, setSnoozing] = useState(false);
  return (
    <SwipeRow
      className="-mx-3 sm:-mx-5"
      contentClassName={cx("flex gap-3 px-3 py-2 transition-colors sm:px-5 sm:py-3", selected ? "bg-tint" : "has-[:is(button,a):hover]:bg-slate-50/80")}
      leading={
        inQueue
          ? { label: "Task", icon: ListPlus, tone: "brand", onClick: () => onCreateTask(thread) }
          : thread.state === "task"
            ? null
            : { label: "Restore", icon: Undo2, tone: "brand", onClick: () => restore.mutateAsync(thread.id) }
      }
      trailing={[
        { label: "Gmail", icon: ExternalLink, tone: "info", href: gmailUrl ?? undefined, hidden: !gmailUrl },
        { label: "View task", icon: ListChecks, tone: "brand", onClick: () => navigate(`/search?q=${encodeURIComponent(thread.subject)}`), hidden: thread.state !== "task" },
        { label: "Snooze", icon: AlarmClock, tone: "snooze", onClick: () => setSnoozing(true), hidden: !inQueue },
        {
          label: "Dismiss",
          icon: X,
          tone: "neutral",
          hidden: !inQueue,
          onClick: () => dismiss.mutateAsync(thread.id).then(() => showUndo({ message: "Email dismissed", undo: { kind: "restore", id: thread.id } })),
        },
      ]}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select email from ${thread.fromName ?? thread.fromEmail}`}
          className="mt-1 size-[18px] shrink-0 accent-brand-600 pointer-coarse:size-5"
        />
      )}
      <div className="min-w-0 flex-1">
        {/* Tapping the email opens it with its attachments */}
        <button onClick={() => onOpen(thread)} className="group/title block w-full text-left" aria-label={`Open email: ${thread.subject}`}>
        <div className="flex items-baseline gap-2">
          {thread.unread && <span className="size-2 shrink-0 -translate-y-px rounded-full bg-brand-600" title="Unread in Gmail" />}
          <span className={cx("truncate text-sm", thread.unread ? "font-semibold text-ink" : "font-medium text-slate-800")}>
            {thread.fromName ?? thread.fromEmail ?? "Unknown sender"}
          </span>
          {thread.messageCount > 1 && <span className="text-xs text-slate-400">({thread.messageCount})</span>}
          <span className="ml-auto shrink-0 text-xs text-slate-500">{formatWhen(thread.lastMessageAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-ink transition-colors group-hover/title:text-brand-700">{thread.subject}</p>
        {/* Compact (user request 2026-10-06): status and labels share the preview line. */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {showStatus && <EmailStatusTags thread={thread} />}
          <LabelChips ids={thread.labelIds} max={2} className="shrink-0 flex-nowrap" />
          <p className="min-w-0 truncate text-[0.8125rem] text-slate-500">{thread.snippet}</p>
        </div>
        </button>
        {/* Actions live in the card's toolbar (EmailBulkBar), not on every email (user request 2026-10-06). */}
      </div>
      <SnoozeSheet id={snoozing ? thread.id : null} onClose={() => setSnoozing(false)} />
    </SwipeRow>
  );
}
