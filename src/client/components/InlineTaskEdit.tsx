// Edit a task's due date/time or priority straight from its chips on the home screen.
// The pop-up is placed on screen (portal + fixed position) so the scrolling panels can't clip it, and it
// follows its chip when the page scrolls.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, Clock } from "lucide-react";
import type { Priority, Task } from "../../shared/types";
import { useUpdateTask } from "../api";
import { addDays, formatDay, formatTime } from "../format";
import { Button, ErrorNote, PRIORITY_TONE, PriorityPill, TONE, cx, inputClass, type Tone } from "./ui";

// Overdue = red, today = orange, later = blue, done or undated = neutral.
export function dueTone(task: Task, today: string): Tone {
  if (task.status === "done" || !task.dueDate) return "neutral";
  if (task.dueDate < today) return "urgent";
  if (task.dueDate === today) return "high";
  return "info";
}

// Every update sends the task's full details plus the one change. (Written when the task API reset fields
// it wasn't sent; the API now changes only what it receives, so this is simply belt and braces.)
function fullInput(task: Task, change: Partial<Pick<Task, "dueDate" | "dueTime" | "priority">>) {
  return {
    title: task.title,
    notes: task.notes,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    ...change,
  };
}

// --- Pop-up anchored to the chip that opened it ---

function useAnchoredPopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Clicking the chip again: the outside-click handler has just closed the pop-up, so don't reopen it.
  const closedAt = useRef(0);
  const open = (el: HTMLElement) => {
    if (Date.now() - closedAt.current > 250) setAnchor(el);
  };
  const close = () => {
    closedAt.current = Date.now();
    setAnchor(null);
  };
  return { anchor, open, close, toggle: (el: HTMLElement) => (anchor ? close() : open(el)) };
}

function AnchoredPopover({ anchor, onClose, width = 288, label, children }: { anchor: HTMLElement; onClose: () => void; width?: number; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });

  // Below the chip, or above it when there isn't room; always inside the screen. Re-placed when the page
  // scrolls or resizes (a phone keyboard opening does both), so it follows its chip instead of closing.
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 240;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
      setPos({ left, top });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [anchor, width]);

  useEffect(() => {
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{ left: pos.left, top: pos.top, width }}
      className="fixed z-50 rounded-xl border border-line bg-white p-3 text-sm shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

// --- Due date and time ---

// layout "time" (To-do card, user request 2026-10-07): only the time, if any, since the row's calendar tile
// shows the date; it still opens the date-and-time pop-up.
export function EditableDue({ task, today, layout }: { task: Task; today: string; layout: "split" | "joined" | "time" }) {
  const pop = useAnchoredPopover();
  const tone = TONE[dueTone(task, today)].soft;
  const chip = "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 whitespace-nowrap transition hover:ring-1 hover:ring-current/40 active:scale-95";
  const label = `Change due date${task.dueDate ? ` (now ${formatDay(task.dueDate, today)}${task.dueTime ? `, ${formatTime(task.dueTime)}` : ""})` : ""}`;
  const openFrom = (e: React.MouseEvent<HTMLElement>) => pop.toggle(e.currentTarget);

  if (layout === "time" && !task.dueTime) return null;
  const trigger =
    layout === "time" ? (
      <button type="button" onClick={openFrom} aria-label={label} title="Change due date and time" className={cx(chip, "text-xs sm:text-footnote", tone)}>
        <Clock size={14} />
        {formatTime(task.dueTime!)}
      </button>
    ) : layout === "joined" ? (
      <button type="button" onClick={openFrom} aria-label={label} title="Change due date" className={cx(chip, "text-xs sm:text-footnote", tone)}>
        <CalendarDays size={14} />
        {task.dueDate ? `${formatDay(task.dueDate, today)}${task.dueTime ? `, ${formatTime(task.dueTime)}` : ""}` : "No date"}
      </button>
    ) : (
      <span className="flex flex-wrap items-center gap-1.5 text-xs sm:text-footnote">
        <button type="button" onClick={openFrom} aria-label={label} title="Change due date" className={cx(chip, task.dueDate ? tone : "text-slate-400 hover:text-slate-600")}>
          {task.dueDate ? (
            <>
              <CalendarDays size={14} className="shrink-0" />
              {formatDay(task.dueDate, today)}
            </>
          ) : (
            "No date"
          )}
        </button>
        {task.dueTime && (
          <button type="button" onClick={openFrom} aria-label={`Change time (now ${formatTime(task.dueTime)})`} title="Change time" className={cx(chip, "bg-slate-100 text-slate-700")}>
            <Clock size={14} className="shrink-0" />
            {formatTime(task.dueTime)}
          </button>
        )}
      </span>
    );

  return (
    <>
      {trigger}
      {pop.anchor && (
        <AnchoredPopover anchor={pop.anchor} onClose={pop.close} label={`Due date for ${task.title}`}>
          <DueForm task={task} today={today} onDone={pop.close} />
        </AnchoredPopover>
      )}
    </>
  );
}

function DueForm({ task, today, onDone }: { task: Task; today: string; onDone: () => void }) {
  const update = useUpdateTask();
  const [date, setDate] = useState(task.dueDate ?? "");
  const [time, setTime] = useState(task.dueTime ?? "");
  const save = (dueDate: string | null, dueTime: string | null) =>
    update.mutate({ id: task.id, input: fullInput(task, { dueDate, dueTime: dueDate ? dueTime : null }) }, { onSuccess: onDone });

  const quick = [
    { label: "Today", day: today },
    { label: "Tomorrow", day: addDays(today, 1) },
    { label: "In a week", day: addDays(today, 7) },
  ];
  const changed = (date || null) !== task.dueDate || ((date && time) || null) !== task.dueTime;

  return (
    <div className="space-y-3">
      <p className="font-medium text-ink">Due date</p>
      <div className="flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <Button key={q.label} size="sm" variant={task.dueDate === q.day ? "primary" : "secondary"} disabled={update.isPending} onClick={() => save(q.day, time || null)}>
            {q.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={update.isPending || !task.dueDate} onClick={() => save(null, null)}>
          No date
        </Button>
      </div>
      {/* Date and time on their own rows: side by side they didn't fit the pop-up (2026-10-07). */}
      <div className="grid gap-2">
        <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" disabled={!date} />
      </div>
      {time && (
        <button type="button" onClick={() => setTime("")} className="text-xs text-slate-500 hover:text-ink hover:underline">
          Remove time
        </button>
      )}
      <ErrorNote error={update.error} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!changed || update.isPending} onClick={() => save(date || null, time || null)}>
          Save
        </Button>
      </div>
    </div>
  );
}

// --- Priority ---

const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];

export function EditablePriority({ task }: { task: Task }) {
  const pop = useAnchoredPopover();
  const update = useUpdateTask();
  const pick = (priority: Priority) => {
    if (priority === task.priority) return pop.close();
    update.mutate({ id: task.id, input: fullInput(task, { priority }) }, { onSuccess: pop.close });
  };
  return (
    <>
      <button
        type="button"
        onClick={(e) => pop.toggle(e.currentTarget)}
        aria-label={`Change priority (now ${PRIORITY_LABEL[task.priority]})`}
        title="Change priority"
        className="rounded-md transition hover:ring-1 hover:ring-slate-300 active:scale-95"
      >
        <PriorityPill priority={task.priority} />
      </button>
      {pop.anchor && (
        <AnchoredPopover anchor={pop.anchor} onClose={pop.close} width={200} label={`Priority for ${task.title}`}>
          <p className="mb-1.5 font-medium text-ink">Priority</p>
          <ul>
            {PRIORITIES.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => pick(p)}
                  disabled={update.isPending}
                  aria-pressed={p === task.priority}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 active:bg-slate-100"
                >
                  <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium", TONE[PRIORITY_TONE[p]].soft)}>
                    <span className={cx("size-1.5 rounded-full", TONE[PRIORITY_TONE[p]].dot)} />
                    {PRIORITY_LABEL[p]}
                  </span>
                  {p === task.priority && <Check size={15} className="text-brand-600" />}
                </button>
              </li>
            ))}
          </ul>
          <ErrorNote error={update.error} />
        </AnchoredPopover>
      )}
    </>
  );
}

const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Medium", low: "Low" };
