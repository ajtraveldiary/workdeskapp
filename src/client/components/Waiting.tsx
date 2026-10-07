// Waiting for a reply (user request 2026-10-07): a task whose next step is someone else's (a reply from a PHC,
// a sanction from the DMO office…). It leaves the to-do lists for the Waiting tab and comes back to Today /
// Overdue on the day a reply is expected, if one is set. An open task can be put to waiting instead of being
// completed, and a completed task can be put back to waiting (it is reopened).
// WaitDialog is opened from anywhere with openWait(task) and lives once in the app shell (WaitDialogHost).
import { Hourglass } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { Task } from "../../shared/types";
import { useMe, useUpdateTask } from "../api";
import { addDays, daysBetween, formatDateTime, formatDay } from "../format";
import { showUndo } from "./SwipeRow";
import { Badge, Button, ErrorNote, Field, Modal, inputClass, type Tone } from "./ui";

export const isWaiting = (t: Task) => !!t.waitingSince && t.status === "open";
// Reminder tasks move with their reminder's date, so they don't wait.
export const canWait = (t: Task) => !t.report;

// "Waiting for reply", "Reply by 12 Oct", "Reply expected today", "Reply overdue 2d · 5 Oct".
export function waitingText(t: Task, today: string): { text: string; tone: Tone } {
  if (!t.replyBy) return { text: "Waiting for reply", tone: "snooze" };
  if (t.replyBy < today) return { text: `Reply overdue ${daysBetween(t.replyBy, today)}d · ${formatDay(t.replyBy, today)}`, tone: "urgent" };
  if (t.replyBy === today) return { text: "Reply expected today", tone: "high" };
  return { text: `Reply by ${formatDay(t.replyBy, today)}`, tone: "snooze" };
}

export function WaitingBadge({ task, today }: { task: Task; today: string }) {
  const { text, tone } = waitingText(task, today);
  return (
    <Badge tone={tone}>
      <Hourglass size={11} className="mr-1 shrink-0" aria-hidden />
      {text}
    </Badge>
  );
}

let opener: ((t: Task) => void) | null = null;
export const openWait = (t: Task) => opener?.(t);

export function WaitDialogHost() {
  const [task, setTask] = useState<Task | null>(null);
  useEffect(() => {
    opener = setTask;
    return () => {
      opener = null;
    };
  }, []);
  return (
    <Modal open={task !== null} onClose={() => setTask(null)} title="Waiting for reply">
      {task && <WaitForm key={task.id} task={task} onDone={() => setTask(null)} />}
    </Modal>
  );
}

function WaitForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const waiting = isWaiting(task);
  const [replyBy, setReplyBy] = useState(waiting ? (task.replyBy ?? "") : "");
  const update = useUpdateTask();
  const quick = [
    { label: "In 3 days", value: addDays(today, 3) },
    { label: "In a week", value: addDays(today, 7) },
    { label: "In 2 weeks", value: addDays(today, 14) },
  ];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({ id: task.id, input: { waiting: true, replyBy: replyBy || null } });
    onDone();
    if (!waiting) showUndo({ message: replyBy ? `Waiting for reply · back on ${formatDay(replyBy, today)}` : "Moved to Waiting for reply" });
  };
  const stop = async () => {
    await update.mutateAsync({ id: task.id, input: { waiting: false } });
    onDone();
    showUndo({ message: "Back in your to-do list" });
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <p className="font-medium text-ink [overflow-wrap:anywhere]">{task.title}</p>
        <p className="mt-1 text-sm text-slate-600">
          {waiting
            ? `Waiting since ${formatDateTime(task.waitingSince!)}.`
            : task.status === "done"
              ? "It goes back to open tasks, under Waiting, until the reply comes."
              : "It moves out of your to-do list to Waiting until the reply comes."}{" "}
          With a date, it comes back to Today on that day if you're still waiting.
        </p>
      </div>
      <Field label="Reply expected by (optional)">
        <input type="date" className={inputClass} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
      </Field>
      <div className="-mt-2 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            type="button"
            key={q.label}
            onClick={() => setReplyBy(q.value)}
            aria-pressed={replyBy === q.value}
            className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 aria-pressed:border-brand-200 aria-pressed:bg-tint aria-pressed:text-brand-800 pointer-coarse:py-1"
          >
            {q.label}
          </button>
        ))}
        {replyBy && (
          <button type="button" onClick={() => setReplyBy("")} className="px-2 py-0.5 text-xs text-slate-500 hover:underline pointer-coarse:py-1">
            No date
          </button>
        )}
      </div>
      <ErrorNote error={update.error} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {waiting && (
          <Button type="button" onClick={stop} disabled={update.isPending} className="mr-auto">
            Back to to-do
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={update.isPending}>
          <Hourglass size={15} /> {waiting ? "Save" : "Wait for reply"}
        </Button>
      </div>
    </form>
  );
}
