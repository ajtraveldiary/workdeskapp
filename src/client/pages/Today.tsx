import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  AlarmClock,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Earth,
  ExternalLink,
  Inbox,
  ListPlus,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Category, Me, Task, Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import {
  useCategories,
  useCompleteTask,
  useDayTasks,
  useDismiss,
  useMe,
  useReopenTask,
  useSummary,
  useSync,
  useUpdateProfile,
} from "../api";
import { addDays, daysBetween, formatWhen } from "../format";
import { Avatar } from "../components/Avatar";
import { SnoozeMenu } from "../components/ThreadRow";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { Button, ErrorNote, Field, Modal, cx, inputClass } from "../components/ui";

export function TodayPage() {
  const me = useMe().data!;
  const { data: summary, error } = useSummary();
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);

  if (error) return <p className="p-8 text-red-700">{error.message}</p>;
  if (!summary) return <p className="p-8 text-sm text-slate-500">Loading…</p>;

  return (
    <div className="xl:flex xl:min-h-[calc(100dvh-2.5rem)]">
      <div className="min-w-0 flex-1 px-4 pt-6 pb-8 md:px-8 md:pt-7">
        <Greeting me={me} />
        <ProfileCard me={me} summary={summary} onEdit={() => setEditingProfile(true)} />

        <SectionTitle title="Dashboard" action={
          <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "new" })}>
            <Plus size={15} /> New task
          </Button>
        } />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile to="/inbox" icon={Inbox} label="Awaiting decision" value={summary.counts.pendingEmails} />
          <StatTile to="/tasks?view=overdue" icon={TriangleAlert} label="Overdue" value={summary.counts.overdue} alert />
          <StatTile to="/tasks?view=today" icon={CalendarDays} label="Due today" value={summary.counts.dueToday} />
          <StatTile to="/tasks?view=upcoming" icon={CalendarClock} label="Due tomorrow" value={summary.counts.dueTomorrow} />
        </div>

        {summary.newActivity.length > 0 && <NewReplies tasks={summary.newActivity} />}

        <DayWork today={summary.today} onEdit={(task) => setDialog({ kind: "edit", task })} />
      </div>

      <EmailPanel threads={summary.pendingEmails} total={summary.counts.pendingEmails} onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })} />

      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
      <ProfileDialog me={me} open={editingProfile} onClose={() => setEditingProfile(false)} />
    </div>
  );
}

// --- Header ---

function Greeting({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = (me.name ?? "").split(" ")[0];

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/inbox?state=all&q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-medium text-ink">
          {hello}
          {first && `, ${first}`}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {new Date(`${me.today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
          {" · Every email accounted for."}
        </p>
      </div>
      <form onSubmit={search} className="relative w-full sm:w-80">
        <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search emails…"
          className="h-11 w-full rounded-xl border border-transparent bg-mint pr-3 pl-10 text-sm placeholder:text-slate-400 focus:border-brand-200"
        />
      </form>
    </header>
  );
}

// --- Profile card ---

function ProfileCard({ me, summary, onEdit }: { me: Me; summary: NonNullable<ReturnType<typeof useSummary>["data"]>; onEdit: () => void }) {
  const sync = useSync();
  const name = me.name ?? me.email;
  const { counts } = summary;
  const parts = [
    counts.pendingEmails && `${counts.pendingEmails} ${counts.pendingEmails === 1 ? "email is" : "emails are"} waiting for a decision`,
    counts.overdue && `${counts.overdue} ${counts.overdue === 1 ? "task is" : "tasks are"} overdue`,
    counts.dueToday && `${counts.dueToday} due today`,
    counts.dueTomorrow && `${counts.dueTomorrow} due tomorrow`,
  ].filter(Boolean);

  return (
    <section className="mb-7 overflow-hidden rounded-2xl border border-line">
      <div className="flex flex-wrap items-center gap-5 bg-mint px-5 py-5 sm:px-6">
        <Avatar name={name} src={me.picture} size={84} className="ring-4 ring-white" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] font-medium text-ink">{name}</h2>
          {me.title ? (
            <p className="mt-0.5 text-sm text-slate-600">{me.title}</p>
          ) : (
            <button onClick={onEdit} className="mt-0.5 text-sm text-brand-700 hover:underline">
              Add your title or office
            </button>
          )}
          <p className="mt-0.5 truncate text-xs text-slate-500">{me.email}</p>
        </div>
        <div className="flex items-start gap-7 sm:gap-8">
          <ProfileStat label="Open tasks" value={counts.openTasks} />
          <ProfileStat label="Done this week" value={counts.completedThisWeek} />
          <button onClick={onEdit} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70 hover:text-ink" title="Edit profile" aria-label="Edit profile">
            <Pencil size={17} />
          </button>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 sm:px-6 2xl:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <h3 className="text-[17px] font-medium text-ink">Daily review</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            {parts.length ? `${capitalise(joinList(parts as string[]))}.` : "Nothing is waiting on you. Every email has a decision and nothing is due today."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link to="/inbox" className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink hover:border-slate-300">
              Open inbox
            </Link>
            <span className="flex items-center gap-1.5 text-sm text-slate-500">
              <Earth size={17} className="text-brand-600" /> {me.timezone.replace("_", " ")}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-4 self-start sm:grid-cols-3 sm:gap-5 rounded-xl bg-mint px-5 py-4 text-sm 2xl:min-w-[440px]">
          <InfoCell label="Gmail">
            {me.demo ? (
              <span className="text-slate-500">Demo mode</span>
            ) : me.account ? (
              <a href="https://mail.google.com" target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-brand-700 hover:underline">
                <span className="truncate">{me.account.email}</span> <ArrowUpRight size={13} className="shrink-0" />
              </a>
            ) : (
              <span className="text-slate-500">Not connected</span>
            )}
          </InfoCell>
          <InfoCell label="Last sync">
            <button onClick={() => sync.mutate()} disabled={sync.isPending} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              {sync.isPending ? "Syncing…" : me.demo ? "Simulate email" : me.account?.lastSyncAt ? formatWhen(me.account.lastSyncAt) : "Sync now"}
              <ArrowUpRight size={13} />
            </button>
          </InfoCell>
          <InfoCell label="Completed">
            <Link to="/tasks?view=completed" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              {counts.completedThisWeek} this week <ArrowUpRight size={13} />
            </Link>
          </InfoCell>
        </dl>
      </div>
    </section>
  );
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-sm font-medium text-ink">{label}</div>
      <div className="text-xs text-slate-500 tabular-nums">{value}</div>
    </div>
  );
}

function InfoCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-ink">{label}</dt>
      <dd className="mt-1 truncate text-xs">{children}</dd>
    </div>
  );
}

const joinList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ProfileDialog({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(me.name ?? "");
  const [title, setTitle] = useState(me.title ?? "");
  useEffect(() => {
    if (open) {
      setName(me.name ?? "");
      setTitle(me.title ?? "");
    }
  }, [open, me.name, me.title]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ name, title: title.trim() || null }, { onSuccess: onClose });
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit profile">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Title or office">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Clerk, District Hospital" />
        </Field>
        <ErrorNote error={update.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

// --- Dashboard tiles ---

function SectionTitle({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[19px] font-medium text-ink">{title}</h2>
      {action}
    </div>
  );
}

function StatTile({ to, icon: Icon, label, value, alert }: { to: string; icon: typeof Inbox; label: string; value: number; alert?: boolean }) {
  const hot = alert && value > 0;
  return (
    <Link to={to} className="group rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-[0_6px_20px_-10px_rgb(31_33_48/0.25)]">
      <span className={cx("flex size-11 items-center justify-center rounded-lg", hot ? "bg-red-50 text-red-600" : "bg-brand-100 text-brand-600")}>
        <Icon size={21} strokeWidth={1.7} />
      </span>
      <div className="mt-5 text-sm text-slate-400">{label}</div>
      <div className={cx("text-[26px] leading-tight font-semibold tabular-nums", hot ? "text-red-600" : "text-ink")}>{value}</div>
    </Link>
  );
}

function NewReplies({ tasks }: { tasks: Task[] }) {
  return (
    <div className="mt-5 rounded-xl border border-violet/30 bg-[#f5f2fe] px-4 py-3 text-sm">
      <span className="font-medium text-ink">New replies on open tasks: </span>
      {tasks.map((t, i) => (
        <span key={t.id} className="text-slate-600">
          {i > 0 && ", "}
          {t.title}
        </span>
      ))}
      <Link to="/tasks" className="ml-2 font-medium text-[#6b51d8] hover:underline">View</Link>
    </div>
  );
}

// --- Work for a day ---

function DayWork({ today, onEdit }: { today: string; onEdit: (t: Task) => void }) {
  const [date, setDate] = useState(today);
  const { data } = useDayTasks(date);
  const categories = useCategories().data ?? [];
  const tasks = data?.date === date ? data.tasks : [];
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const isToday = date === today;
  const dayLabel = isToday ? "Today" : date === addDays(today, 1) ? "Tomorrow" : date === addDays(today, -1) ? "Yesterday" : null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[19px] text-ink">
          <span className="font-medium">Work</span> <span className="text-slate-500">for {dayLabel ?? shortDate(date)} ({tasks.length})</span>
        </h2>
        <div className="flex items-center gap-1">
          {!isToday && (
            <button onClick={() => setDate(today)} className="mr-2 rounded-lg px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-mint">
              Today
            </button>
          )}
          <button onClick={() => setDate(addDays(date, -1))} className="rounded-lg p-1.5 text-ink hover:bg-slate-100" aria-label="Previous day">
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-36 text-center text-[17px] font-medium text-ink tabular-nums">{longDate(date)}</span>
          <button onClick={() => setDate(addDays(date, 1))} className="rounded-lg p-1.5 text-ink hover:bg-slate-100" aria-label="Next day">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white">
        {tasks.length > 0 && (
          <div className="flex items-center gap-4 border-b border-line px-5 py-3 text-xs text-slate-500">
            <span>Progress</span>
            <ProgressBar pct={pct} className="flex-1 sm:max-w-56" />
            <span className="tabular-nums">
              {done} of {tasks.length} done
            </span>
          </div>
        )}
        {tasks.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {isToday ? "Nothing due today. Tasks with today's due date show up here." : "No tasks due on this day."}
          </p>
        ) : (
          <ul className="divide-y divide-line px-5">
            {tasks.map((t) => (
              <WorkRow key={t.id} task={t} today={today} categories={categories} onEdit={onEdit} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function WorkRow({ task, today, categories, onEdit }: { task: Task; today: string; categories: Category[]; onEdit: (t: Task) => void }) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const done = task.status === "done";
  const overdue = !done && !!task.dueDate && task.dueDate < today;
  const category = categories.find((c) => c.id === task.categoryId)?.name;
  const context = [category, task.thread && `From ${task.thread.fromName ?? task.thread.fromEmail}`].filter(Boolean).join(" · ") || "Manual task";
  const gmailUrl = task.thread && gmailThreadUrl(task.thread.accountEmail, task.thread.gmailThreadId);
  const toggle = () => (done ? reopen.mutate(task.id) : complete.mutate(task.id));

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[auto_minmax(0,1fr)_200px_auto]">
      <button
        onClick={toggle}
        aria-label={done ? "Reopen task" : "Mark task complete"}
        title={done ? "Reopen" : "Mark complete"}
        className={cx(
          "flex size-[22px] items-center justify-center rounded-full border-2 transition-colors",
          done ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 text-transparent hover:border-brand-500 hover:text-brand-500",
        )}
      >
        <Check size={13} strokeWidth={3} />
      </button>
      <button onClick={() => onEdit(task)} className="min-w-0 text-left">
        <div className="truncate text-[13px] text-slate-500">{context}</div>
        <div className={cx("truncate text-[15px] font-medium", done ? "text-slate-400 line-through" : "text-ink")}>{task.title}</div>
      </button>
      <div className="col-span-3 col-start-2 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto">
        <ProgressBar pct={done ? 100 : overdue ? 100 : priorityPct[task.priority]} tone={done ? "green" : overdue ? "red" : "green"} />
        <div className="mt-1.5 flex justify-between text-xs text-slate-500">
          <span>{done ? "Complete" : overdue ? `Overdue ${daysBetween(task.dueDate!, today)}d` : `${capitalise(task.priority)} priority`}</span>
          <span>{task.dueDate ? shortDate(task.dueDate) : "No date"}</span>
        </div>
      </div>
      <RowMenu
        items={[
          { label: "Edit", onClick: () => onEdit(task) },
          { label: done ? "Reopen" : "Mark complete", onClick: toggle },
          ...(gmailUrl ? [{ label: "Open email in Gmail", href: gmailUrl }] : []),
        ]}
      />
    </li>
  );
}

const priorityPct = { low: 25, normal: 50, high: 75, urgent: 95 } as const;

function ProgressBar({ pct, tone = "green", className }: { pct: number; tone?: "green" | "red"; className?: string }) {
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-slate-100", className)}>
      <div className={cx("h-full rounded-full", tone === "red" ? "bg-red-400" : "bg-brand-500")} style={{ width: `${pct}%` }} />
    </div>
  );
}

function RowMenu({ items }: { items: { label: string; onClick?: () => void; href?: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 text-ink hover:bg-slate-100" aria-label="More actions" aria-expanded={open}>
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-line bg-white p-1 shadow-lg">
          {items.map((it) =>
            it.href ? (
              <a key={it.label} href={it.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                {it.label}
              </a>
            ) : (
              <button key={it.label} onClick={() => { it.onClick?.(); setOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const longDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// --- Right panel: emails awaiting a decision ---

function EmailPanel({ threads, total, onCreateTask }: { threads: Thread[]; total: number; onCreateTask: (t: Thread) => void }) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const shown = filter
    ? threads.filter((t) => `${t.fromName} ${t.fromEmail} ${t.subject} ${t.snippet}`.toLowerCase().includes(filter.toLowerCase()))
    : threads;
  const selected = shown.find((t) => t.id === selectedId) ?? shown[0];

  return (
    <aside className="border-t border-line xl:w-[400px] xl:shrink-0 xl:border-t-0 xl:border-l">
      <div className="flex h-[76px] items-center justify-between gap-3 border-b border-line px-5">
        {filter === null ? (
          <h2 className="text-[19px] font-medium text-ink">
            Emails awaiting decision
          </h2>
        ) : (
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter these emails…"
            className="h-10 min-w-0 flex-1 rounded-lg bg-mint px-3 text-sm"
          />
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilter(filter === null ? "" : null)}
            className="rounded-lg p-1.5 text-ink hover:bg-slate-100"
            aria-label={filter === null ? "Filter emails" : "Close filter"}
          >
            {filter === null ? <Search size={20} /> : <X size={20} />}
          </button>
          <RowMenu items={[{ label: `Open inbox (${total})`, onClick: () => navigate("/inbox") }, { label: "Dismissed emails", onClick: () => navigate("/inbox?state=dismissed") }]} />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-mint text-brand-600">
            <Check size={22} />
          </span>
          <p className="mt-3 font-medium text-ink">{filter ? "No matching emails" : "Inbox clear"}</p>
          <p className="mt-1 text-sm text-slate-500">{filter ? "Try another word." : "Every email has a decision."}</p>
        </div>
      ) : (
        <>
          <ul className="space-y-1 px-3 py-3">
            {shown.map((t) => (
              <EmailItem key={t.id} thread={t} active={t.id === selected?.id} onSelect={() => setSelectedId(t.id)} />
            ))}
          </ul>
          {total > threads.length && !filter && (
            <Link to="/inbox" className="block px-6 pb-3 text-sm font-medium text-brand-700 hover:underline">
              View all {total} in Inbox
            </Link>
          )}
          {selected && <EmailDetail key={selected.id} thread={selected} onCreateTask={onCreateTask} />}
        </>
      )}
    </aside>
  );
}

function EmailItem({ thread, active, onSelect }: { thread: Thread; active: boolean; onSelect: () => void }) {
  const name = thread.fromName ?? thread.fromEmail ?? "Unknown sender";
  return (
    <li>
      <button
        onClick={onSelect}
        className={cx(
          "relative flex w-full gap-3.5 px-4 py-4 text-left transition-colors",
          active ? "z-10 rounded-xl bg-ink text-white shadow-[0_12px_30px_-10px_rgb(31_33_48/0.6)]" : "rounded-xl hover:bg-slate-50",
        )}
      >
        <Avatar name={name} size={44} ring={active} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cx("truncate font-medium", active ? "text-white" : "text-ink")}>{name}</span>
            {thread.unread && (
              <span className={cx("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", active ? "bg-brand-500 text-white" : "bg-brand-100 text-brand-700")}>
                Unread
              </span>
            )}
          </div>
          <p className={cx("mt-0.5 truncate text-[13px] font-medium", active ? "text-white/90" : "text-slate-700")}>{thread.subject}</p>
          <p className={cx("mt-0.5 line-clamp-2 text-[13px] leading-relaxed", active ? "text-white/70" : "text-slate-500")}>{thread.snippet}</p>
          <p className={cx("mt-1 text-right text-xs", active ? "text-white/80" : "text-slate-500")}>{formatWhen(thread.lastMessageAt)}</p>
        </div>
      </button>
    </li>
  );
}

function EmailDetail({ thread, onCreateTask }: { thread: Thread; onCreateTask: (t: Thread) => void }) {
  const dismiss = useDismiss();
  const name = thread.fromName ?? thread.fromEmail ?? "Unknown sender";
  const gmailUrl = gmailThreadUrl(thread.accountEmail, thread.gmailThreadId);
  const time = new Date(thread.lastMessageAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="mx-3 mt-1 mb-6 rounded-2xl bg-mint px-4 pt-4 pb-5">
      <div className="flex items-center gap-3 border-b border-brand-200/70 pb-3">
        <Avatar name={name} size={40} ring />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{name}</div>
          <div className="truncate text-xs text-slate-500">{thread.fromEmail}</div>
        </div>
        <button
          onClick={() => onCreateTask(thread)}
          className="flex size-9 items-center justify-center rounded-full bg-violet text-white hover:opacity-90"
          title="Create task"
          aria-label="Create task"
        >
          <ListPlus size={17} />
        </button>
        {gmailUrl && (
          <a
            href={gmailUrl}
            target="_blank"
            rel="noreferrer"
            className="flex size-9 items-center justify-center rounded-full bg-violet text-white hover:opacity-90"
            title="Open in Gmail"
            aria-label="Open in Gmail"
          >
            <ExternalLink size={16} />
          </a>
        )}
      </div>

      <div className="mt-4 flex gap-3">
        <Avatar name={name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-ink">
            {name.split(" ")[0]}, {time}
          </div>
          <div className="mt-1.5 rounded-xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-600 shadow-[0_1px_2px_rgb(31_33_48/0.05)]">
            <p className="font-medium text-ink">{thread.subject}</p>
            <p className="mt-1 leading-relaxed">{thread.snippet}</p>
            {thread.messageCount > 1 && <p className="mt-1.5 text-xs text-slate-400">{thread.messageCount} messages in this conversation</p>}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => onCreateTask(thread)}>
          <ListPlus size={15} /> Create task
        </Button>
        <SnoozeMenu id={thread.id} icon={<AlarmClock size={15} />} />
        <Button size="sm" onClick={() => dismiss.mutate(thread.id)} disabled={dismiss.isPending} title="Remove from the queue. Gmail is not changed.">
          <X size={15} /> Dismiss
        </Button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Dismissing only removes it from WorkDesk. Nothing changes in Gmail.</p>
    </div>
  );
}
