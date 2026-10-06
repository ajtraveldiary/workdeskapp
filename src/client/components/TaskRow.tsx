import { Check, Eye, ExternalLink, FileText, Mail, Pencil, RotateCcw } from "lucide-react";
import type { Task } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useCompleteTask, useMarkSeen, useReopenTask } from "../api";
import { daysBetween, formatDateTime, formatDay, formatTime } from "../format";
import { Badge, PriorityPill, cx } from "./ui";
import { SwipeRow, showUndo, useSwipeMode } from "./SwipeRow";
import { LabelChips } from "./LabelChips";

export function TaskRow({
  task,
  today,
  onEdit,
  onOpen,
}: {
  task: Task;
  today: string;
  onEdit: (t: Task) => void;
  // When given, tapping the title opens the task's email (or its details) and editing gets its own button.
  onOpen?: (t: Task) => void;
}) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const seen = useMarkSeen();
  const done = task.status === "done";
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const gmailUrl = task.thread && gmailThreadUrl(task.thread.accountEmail, task.thread.gmailThreadId);
  // Phones: swipe right to complete (or reopen), left for Gmail / seen / edit; the side buttons go away.
  const swipe = useSwipeMode();

  return (
    <SwipeRow
      contentClassName={cx("flex items-start gap-3 py-3 transition-colors has-[:is(button,a):hover]:bg-slate-50/80", swipe ? "px-3" : "px-4")}
      leading={
        done
          ? { label: "Reopen", icon: RotateCcw, tone: "neutral", onClick: () => reopen.mutateAsync(task.id) }
          : {
              label: "Done",
              icon: Check,
              tone: "low",
              onClick: () => complete.mutateAsync(task.id).then(() => showUndo({ message: "Task completed", undo: { kind: "reopen", id: task.id } })),
            }
      }
      trailing={[
        { label: "Gmail", icon: ExternalLink, tone: "info", href: gmailUrl || undefined, hidden: !gmailUrl },
        { label: "Seen", icon: Eye, tone: "brand", onClick: () => seen.mutate(task.thread!.id), hidden: !task.thread?.hasNewActivity || done },
        { label: "Edit", icon: Pencil, tone: "neutral", onClick: () => onEdit(task) },
      ]}
    >
      {!swipe && (
      <button
        onClick={() => (done ? reopen.mutate(task.id) : complete.mutate(task.id))}
        disabled={complete.isPending || reopen.isPending}
        aria-label={done ? "Reopen task" : "Mark task complete"}
        title={done ? "Reopen" : "Mark complete"}
        className={cx(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 pointer-coarse:size-6",
          done ? "border-low bg-low text-white" : "border-slate-300 text-transparent hover:border-low hover:text-low",
        )}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      )}

      <div className="min-w-0 flex-1">
        <button
          onClick={() => (onOpen ? onOpen(task) : onEdit(task))}
          className="group/title text-left"
          aria-label={onOpen ? (task.thread ? `Open the email for: ${task.title}` : `Show details: ${task.title}`) : undefined}
        >
          <span className={cx("text-[0.8125rem] leading-snug font-medium sm:text-sm", done ? "text-slate-500 line-through" : "text-slate-900 group-hover/title:text-brand-700")}>{task.title}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {task.dueDate && !done && (
            <Badge tone={overdue ? "urgent" : task.dueDate === today ? "high" : "info"}>
              {overdue ? `Overdue ${daysBetween(task.dueDate, today)}d · ${formatDay(task.dueDate, today)}` : `Due ${formatDay(task.dueDate, today)}`}
              {task.dueTime && `, ${formatTime(task.dueTime)}`}
            </Badge>
          )}
          <PriorityPill priority={task.priority} />
          <LabelChips ids={task.labelIds} />
          {done && task.completedAt && <span>Completed {formatDateTime(task.completedAt)}</span>}
          {task.report && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <FileText size={12} className="shrink-0" />
              <span className="truncate">Report: {task.report.label}</span>
            </span>
          )}
          {task.thread && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Mail size={12} className="shrink-0" />
              <span className="truncate">
                {task.thread.fromName ?? task.thread.fromEmail}: {task.thread.subject}
              </span>
            </span>
          )}
        </div>
        {task.notes && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{task.notes}</p>}
        {task.thread?.hasNewActivity && !done && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-brand-100 px-2.5 py-1.5 text-xs text-brand-800">
            <span className="font-medium">New reply in the linked email.</span>
            {gmailUrl && (
              <a href={gmailUrl} target="_blank" rel="noreferrer" className="underline">
                Read in Gmail
              </a>
            )}
            <button onClick={() => seen.mutate(task.thread!.id)} className="underline">
              Mark seen
            </button>
          </div>
        )}
      </div>

      {onOpen && !swipe && (
        <button
          onClick={() => onEdit(task)}
          title="Edit task"
          aria-label="Edit task"
          className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-90 pointer-coarse:p-2"
        >
          <Pencil size={16} />
        </button>
      )}
      {gmailUrl && !swipe && (
        <a
          href={gmailUrl}
          target="_blank"
          rel="noreferrer"
          title="Open email in Gmail"
          className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 pointer-coarse:p-2"
        >
          <ExternalLink size={16} />
        </a>
      )}
      {done && !swipe && (
        <button
          onClick={() => reopen.mutate(task.id)}
          title="Reopen"
          className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 pointer-coarse:p-2"
        >
          <RotateCcw size={16} />
        </button>
      )}
    </SwipeRow>
  );
}
