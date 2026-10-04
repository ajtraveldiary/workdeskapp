import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Task } from "../../shared/types";
import { useCategories, useMe, useRangeTasks } from "../api";
import { addDays, formatTime } from "../format";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { TaskRow } from "../components/TaskRow";
import { Button, Card, Empty, PRIORITY_BAR, PageHeader, cx } from "../components/ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const days = gridDays(month);
  const { data } = useRangeTasks(days[0]!, days.at(-1)!);
  const categories = useCategories().data ?? [];

  const byDay = new Map<string, Task[]>();
  for (const t of data?.tasks ?? []) {
    if (!t.dueDate) continue;
    byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), t]);
  }
  const selectedTasks = byDay.get(selected) ?? [];
  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const selectedLabel = new Date(`${selected}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Tasks by due date. Click a day to see or add its work."
        actions={
          <div className="flex items-center gap-1">
            {month !== monthStart(today) && (
              <Button size="sm" variant="ghost" onClick={() => { setMonth(monthStart(today)); setSelected(today); }}>
                Today
              </Button>
            )}
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <span className="min-w-40 text-center text-lg font-medium text-ink">{monthLabel}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line bg-canvas-soft text-center text-xs font-medium text-slate-500">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const tasks = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === month.slice(0, 7);
              const isToday = day === today;
              return (
                <button
                  key={day}
                  onClick={() => setSelected(day)}
                  className={cx(
                    "flex min-h-20 flex-col items-stretch gap-1 border-line p-1.5 text-left transition-colors sm:min-h-28",
                    i % 7 !== 6 && "border-r",
                    i < 35 && "border-b",
                    !inMonth && "bg-slate-50/70",
                    day === selected ? "bg-tint ring-2 ring-brand-500 ring-inset" : "hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-7 items-center justify-center self-start rounded-full text-sm tabular-nums",
                      isToday ? "bg-brand-600 font-semibold text-white" : inMonth ? "text-ink" : "text-slate-400",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {/* Dots on phones, titled chips on wider screens */}
                  <span className="flex flex-wrap gap-1 sm:hidden">
                    {tasks.slice(0, 4).map((t) => (
                      <span key={t.id} className={cx("size-1.5 rounded-full", t.status === "done" ? "bg-slate-300" : PRIORITY_BAR[t.priority])} />
                    ))}
                  </span>
                  <span className="hidden flex-col gap-1 sm:flex">
                    {tasks.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className={cx(
                          "truncate rounded border-l-2 px-1.5 py-0.5 text-[11px]",
                          t.status === "done" ? "border-slate-300 bg-slate-50 text-slate-400 line-through" : CHIP[t.priority],
                        )}
                      >
                        {t.dueTime && `${formatTime(t.dueTime)} `}
                        {t.title}
                      </span>
                    ))}
                    {tasks.length > 3 && <span className="px-1 text-[11px] text-slate-500">+{tasks.length - 3} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="self-start">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-medium text-ink">{selected === today ? `Today · ${selectedLabel}` : selectedLabel}</h2>
            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "new", dueDate: selected })}>
              <Plus size={15} /> Add
            </Button>
          </div>
          {selectedTasks.length === 0 ? (
            <Empty title="Nothing due">Add a task for this day.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {selectedTasks.map((t) => (
                <TaskRow key={t.id} task={t} today={today} categories={categories} onEdit={(task) => setDialog({ kind: "edit", task })} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
