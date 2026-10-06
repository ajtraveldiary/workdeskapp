import { useRef, useState, useSyncExternalStore } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Link } from "react-router";
import type { Report, Task } from "../../shared/types";
import { occurrences, remindLabel } from "../../shared/reminderSchedule";
import { useMe, useRangeTasks, useReports, useThread } from "../api";
import { EmailViewer } from "../components/EmailViewer";
import { TaskDetails } from "../components/TaskDetails";
import { addDays, formatDay, formatTime } from "../format";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { TaskRow } from "../components/TaskRow";
import { Button, Card, Empty, PRIORITY_BAR, PageHeader, cx } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Phones get an app-style month view (user request 2026-10-06): the month as the title, a compact grid with
// dots, swiping between months. Wider screens keep the large grid with titled chips.
const PHONE = "(max-width: 639.98px)";
function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

// Hollow dots for reminder dates whose task isn't created yet.
const RING = {
  urgent: "border-urgent",
  high: "border-high",
  normal: "border-medium",
  low: "border-low",
} as const;

const CHIP = {
  urgent: "bg-urgent-soft text-urgent-ink border-urgent",
  high: "bg-high-soft text-high-ink border-high",
  normal: "bg-medium-soft text-medium-ink border-medium",
  low: "bg-low-soft text-low-ink border-low",
} as const;

function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`;
}

function shiftMonth(first: string, n: number) {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Monday on or before the 1st, six weeks long.
function gridDays(first: string) {
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function CalendarPage() {
  const today = useMe().data!.today;
  const [month, setMonth] = useState(monthStart(today));
  const [selected, setSelected] = useState(today);
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  // Tapping a task opens the email it came from, or (for tasks without one) its details.
  const [emailId, setEmailId] = useState<string | null>(null);
  const [details, setDetails] = useState<Task | null>(null);
  const email = useThread(emailId).data ?? null;
  const openTask = (t: Task) => (t.thread ? setEmailId(t.thread.id) : setDetails(t));
  const days = gridDays(month);
  const { data } = useRangeTasks(days[0]!, days.at(-1)!);

  const byDay = new Map<string, Task[]>();
  for (const t of data?.tasks ?? []) {
    if (!t.dueDate) continue;
    byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), t]);
  }
  const selectedTasks = byDay.get(selected) ?? [];

  // Reminder dates still to come in this view whose task doesn't exist yet (user request 2026-10-06: show
  // reminders in every month, not only once their task is created). Shown hollow / dashed.
  const reminders = useReports().data?.reports ?? [];
  const scheduled = new Map<string, Report[]>();
  const first = days[0]!;
  const last = days.at(-1)!;
  for (const r of reminders) {
    if (!r.active) continue;
    const created = new Set(r.periods.map((p) => p.dueDate));
    for (const d of occurrences(r, (day) => day <= last, 5000)) {
      if (d < first || d < today || created.has(d) || byDay.get(d)?.some((t) => t.report?.reportId === r.id)) continue;
      scheduled.set(d, [...(scheduled.get(d) ?? []), r]);
    }
  }
  const selectedScheduled = scheduled.get(selected) ?? [];
  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const phone = usePhone();
  const selectedLabel = new Date(`${selected}T00:00:00Z`).toLocaleDateString("en-IN", phone ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" } : { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const goMonth = (n: number) => setMonth(shiftMonth(month, n));
  // Phones: swipe the grid sideways to change month.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  return (
    <>
      <PageHeader
        title={phone ? monthLabel : "Calendar"}
        subtitle="Tasks by due date. Click a day to see or add its work."
        actions={
          <div className="flex items-center gap-1">
            <RefreshButton keys={[["tasks"]]} label="Refresh calendar" />
            {month !== monthStart(today) && (
              <Button size="sm" variant="ghost" onClick={() => { setMonth(monthStart(today)); setSelected(today); }}>
                Today
              </Button>
            )}
            <button onClick={() => goMonth(-1)} className="rounded-lg p-2 hover:bg-slate-100 active:scale-90 pointer-coarse:p-2" aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            {!phone && <span className="min-w-40 text-center text-lg font-medium text-ink">{monthLabel}</span>}
            <button onClick={() => goMonth(1)} className="rounded-lg p-2 hover:bg-slate-100 active:scale-90 pointer-coarse:p-2" aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>
        }
      />

      <div className="grid gap-3 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 bg-canvas-soft text-center text-xs font-medium text-slate-500 sm:border-b sm:border-line">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1.5 sm:py-2">
                <span className="sm:hidden">{d[0]}</span>
                <span className="max-sm:hidden">{d}</span>
              </div>
            ))}
          </div>
          <div
            className="grid grid-cols-7 max-sm:px-1 max-sm:pb-1"
            onTouchStart={(e) => (swipe.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })}
            onTouchEnd={(e) => {
              const start = swipe.current;
              swipe.current = null;
              if (!start || !phone) return;
              const dx = e.changedTouches[0]!.clientX - start.x;
              const dy = e.changedTouches[0]!.clientY - start.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goMonth(dx < 0 ? 1 : -1);
            }}
          >
            {days.map((day, i) => {
              const tasks = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === month.slice(0, 7);
              const isToday = day === today;
              return (
                <button
                  key={day}
                  onClick={() => setSelected(day)}
                  aria-label={day}
                  aria-pressed={day === selected}
                  className={cx(
                    // Phones: a compact cell, the date centred with dots below; wider: a bordered box with chips.
                    "no-tap flex h-12 flex-col items-center gap-0.5 rounded-lg pt-1 transition-colors active:bg-brand-50 sm:h-auto sm:min-h-28 sm:items-stretch sm:gap-1 sm:rounded-none sm:border-line sm:p-1.5 sm:text-left",
                    i % 7 !== 6 && "sm:border-r",
                    i < 35 && "sm:border-b",
                    !inMonth && "sm:bg-slate-50/70",
                    day === selected ? "sm:bg-tint sm:ring-2 sm:ring-brand-500 sm:ring-inset" : "sm:hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-7 items-center justify-center rounded-full text-sm tabular-nums sm:self-start",
                      isToday ? "bg-brand-600 font-semibold text-white" : inMonth ? "text-ink" : "text-slate-300 sm:text-slate-400",
                      day === selected && !isToday && "ring-2 ring-brand-500 max-sm:font-semibold max-sm:text-brand-700 sm:ring-0",
                      day === selected && isToday && "ring-2 ring-brand-200 sm:ring-0",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {/* Dots on phones, titled chips on wider screens */}
                  <span className="flex gap-0.5 sm:hidden">
                    {tasks.slice(0, 3).map((t) => (
                      <span key={t.id} className={cx("size-1.5 rounded-full", t.status === "done" ? "bg-slate-300" : PRIORITY_BAR[t.priority])} />
                    ))}
                    {(scheduled.get(day) ?? []).slice(0, Math.max(0, 3 - tasks.length)).map((r) => (
                      <span key={r.id} className={cx("size-1.5 rounded-full border", RING[r.priority])} />
                    ))}
                  </span>
                  <span className="hidden flex-col gap-1 sm:flex">
                    {tasks.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className={cx(
                          "truncate rounded border-l-2 px-1.5 py-0.5 text-[0.6875rem]",
                          t.status === "done" ? "border-slate-300 bg-slate-50 text-slate-400 line-through" : CHIP[t.priority],
                        )}
                      >
                        {t.dueTime && `${formatTime(t.dueTime)} `}
                        {t.title}
                      </span>
                    ))}
                    {(scheduled.get(day) ?? []).slice(0, Math.max(0, 3 - tasks.length)).map((r) => (
                      <span key={r.id} className="truncate rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[0.6875rem] text-slate-500">
                        {r.dueTime && `${formatTime(r.dueTime)} `}
                        {r.name}
                      </span>
                    ))}
                    {tasks.length + (scheduled.get(day)?.length ?? 0) > 3 && (
                      <span className="px-1 text-[0.6875rem] text-slate-500">+{tasks.length + (scheduled.get(day)?.length ?? 0) - 3} more</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="self-start">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4 sm:py-3">
            <h2 className="font-medium text-ink">{selected === today ? (phone ? `${selectedLabel} · Today` : `Today · ${selectedLabel}`) : selectedLabel}</h2>
            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "new", dueDate: selected })}>
              <Plus size={15} /> Add
            </Button>
          </div>
          {selectedTasks.length === 0 && selectedScheduled.length === 0 ? (
            <Empty title="Nothing due">Add a task for this day.</Empty>
          ) : selectedTasks.length === 0 ? null : (
            <ul className="divide-y divide-line">
              {selectedTasks.map((t) => (
                <TaskRow key={t.id} task={t} today={today} onEdit={(task) => setDialog({ kind: "edit", task })} onOpen={openTask} />
              ))}
            </ul>
          )}
          {selectedScheduled.length > 0 && <ScheduledList reminders={selectedScheduled} day={selected} today={today} />}
        </Card>
      </div>

      <EmailViewer
        thread={emailId ? email : null}
        onClose={() => setEmailId(null)}
        onCreateTask={(thread) => {
          setEmailId(null);
          setDialog({ kind: "fromThread", thread });
        }}
      />
      <TaskDetails
        task={details}
        onClose={() => setDetails(null)}
        onEdit={(t) => {
          setDetails(null);
          setDialog({ kind: "edit", task: t });
        }}
      />
      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

// Reminders due on the selected day whose task will be created later.
function ScheduledList({ reminders, day, today }: { reminders: Report[]; day: string; today: string }) {
  return (
    <div className="border-t border-line first:border-t-0">
      <p className="px-3 pt-2.5 text-xs font-medium text-slate-500 sm:px-4">Coming up</p>
      <ul className="divide-y divide-line">
        {reminders.map((r) => (
          <li key={r.id} className="flex items-start gap-2.5 px-3 py-2.5 sm:px-4">
            <span className={cx("mt-1.5 size-2 shrink-0 rounded-full border-2", RING[r.priority])} aria-hidden />
            <div className="min-w-0 flex-1">
              <Link to="/reminders" className="text-[0.9375rem] font-medium text-ink hover:text-brand-700 hover:underline">
                <CalendarClock size={13} className="mr-1 inline -translate-y-px text-slate-400" aria-hidden />
                {r.name}
              </Link>
              <p className="text-xs text-slate-500">
                {r.dueTime ? `${formatTime(r.dueTime)} · ` : ""}
                {r.leadDays > 0 ? `Task appears ${formatDay(addDays(day, -r.leadDays), today)} (${remindLabel(r.leadDays)})` : "Task appears on the day"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
