import { Check, Eye, ExternalLink, CalendarClock, FileClock, Hourglass, Mail, Pencil, RotateCcw } from "lucide-react";
import type { Task } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useCompleteTask, useMarkSeen, useReopenTask } from "../api";
import { daysBetween, formatDateTime, formatDay, formatTime } from "../format";
import { ChecklistChip } from "./Checklist";
import { RelatedTag } from "./Related";
import { WaitingBadge, canWait, isWaiting, openWait } from "./Waiting";
import { Badge, PRIORITY_BAR, cx } from "./ui";
import { SwipeRow, showUndo, useSwipeMode } from "./SwipeRow";
import { isContractTask, openContract } from "./ContractChooser";

export function TaskRow({
  task,
  today,
  onEdit,
  onOpen,
  onDetails,
}: {
  task: Task;
  today: string;
  onEdit: (t: Task) => void;
  // Opens the task details card (from the checklist chip, to tick steps).
  onDetails?: (t: Task) => void;
  // When given, tapping the title opens the task's email (or its details) and editing gets its own button.
  onOpen?: (t: Task) => void;
}) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const seen = useMarkSeen();
  const done = task.status === "done";
  const waiting = isWaiting(task);
  // A "Contract ends" task asks Renew or Contract ended instead of being ticked (user request 2026-10-08).
  const contract = isContractTask(task);
  const overdue = !done && !waiting && task.dueDate !== null && task.dueDate < today;
  const gmailUrl = task.thread && gmailThreadUrl(task.thread.accountEmail, task.thread.gmailThreadId);
  // Phones: swipe right to complete (or reopen), left for Gmail / seen / edit; the side buttons go away.
  const swipe = useSwipeMode();

  return (
    <SwipeRow
      // Compact rows (user request 2026-10-07): tighter padding, one line of notes.
      contentClassName={cx("row-click flex items-start gap-2.5 py-2 transition-colors has-[:is(button,a):hover]:bg-slate-50/80 sm:py-2.5", swipe ? "px-3" : "px-4")}
      leading={
        done
          ? { label: "Reopen", icon: RotateCcw, tone: "neutral", onClick: () => reopen.mutateAsync(task.id) }
          : contract
            ? { label: "Contract", icon: FileClock, tone: "high", onClick: () => openContract(task) }
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
        // Waiting for a reply (user request 2026-10-07): also for completed tasks, which it reopens.
        { label: waiting ? "Waiting" : "Wait", icon: Hourglass, tone: "snooze", onClick: () => openWait(task), hidden: !canWait(task) },
        { label: "Edit", icon: Pencil, tone: "neutral", onClick: () => onEdit(task) },
      ]}
    >
      {!swipe && (
      <button
        onClick={() => (done ? reopen.mutate(task.id) : contract ? openContract(task) : complete.mutate(task.id))}
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
      {/* Priority shows as colour (and grouping on the Tasks page), not a badge (user request 2026-10-06). */}
      <span className={cx("w-[3px] self-stretch rounded-full", PRIORITY_BAR[task.priority], done && "opacity-40")} aria-hidden />

      <div className="min-w-0 flex-1">
        <button
          onClick={() => (onOpen ? onOpen(task) : onEdit(task))}
          className="row-link group/title block w-full text-left"
          aria-label={onOpen ? (task.thread ? `Open the email for: ${task.title}` : `Show details: ${task.title}`) : undefined}
        >
          <span className={cx("line-clamp-3 text-subhead leading-snug font-medium [overflow-wrap:anywhere]", done ? "text-slate-500 line-through" : "text-slate-900 group-hover/title:text-brand-700")}>{task.title}</span>
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {waiting && <WaitingBadge task={task} today={today} />}
          {task.dueDate && !done && !waiting && (
            <Badge tone={overdue ? "urgent" : task.dueDate === today ? "high" : "info"}>
              {overdue ? `Overdue ${daysBetween(task.dueDate, today)}d · ${formatDay(task.dueDate, today)}` : `Due ${formatDay(task.dueDate, today)}`}
              {task.dueTime && `, ${formatTime(task.dueTime)}`}
            </Badge>
          )}
          {done && task.completedAt && <span>Completed {formatDateTime(task.completedAt)}</span>}
          <ChecklistChip items={task.checklist} onClick={onDetails && (() => onDetails(task))} />
          <RelatedTag value={task} />
          {task.report && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <CalendarClock size={12} className="shrink-0" />
              <span className="truncate">Reminder</span>
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
        {task.notes && <p className="mt-0.5 line-clamp-1 text-footnote text-slate-500">{task.notes}</p>}
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
