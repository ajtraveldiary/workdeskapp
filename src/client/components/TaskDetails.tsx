// Read-only view of a task, with what was entered when it was created. Opened from task lists; for a task
// made from an email it also names the email and can open it (onOpenEmail).
import { CalendarDays, Check, Clock, CalendarClock, Hourglass, Mail, Pencil, RotateCcw, StickyNote } from "lucide-react";
import type { ReactNode } from "react";
import type { Task } from "../../shared/types";
import { useCompleteTask, useMe, useReopenTask } from "../api";
import { formatDateTime, formatDay, formatTime, formatWhen } from "../format";
import { ChecklistTicks } from "./Checklist";
import { LinkChips } from "./ReminderLinks";
import { canWait, isWaiting, openWait, waitingText } from "./Waiting";
import { Badge, Button, Modal, PriorityPill, cx } from "./ui";

export function TaskDetails({
  task,
  onClose,
  onEdit,
  onOpenEmail,
}: {
  task: Task | null;
  onClose: () => void;
  onEdit: (t: Task) => void;
  onOpenEmail?: (threadId: string) => void;
}) {
  return (
    <Modal open={task !== null} onClose={onClose} title="Task details" closeOnBackdrop>
      {task && <Details task={task} onClose={onClose} onEdit={onEdit} onOpenEmail={onOpenEmail} />}
    </Modal>
  );
}

function Details({ task, onClose, onEdit, onOpenEmail }: { task: Task; onClose: () => void; onEdit: (t: Task) => void; onOpenEmail?: (threadId: string) => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const done = task.status === "done";
  const waiting = isWaiting(task);
  const overdue = !done && !waiting && !!task.dueDate && task.dueDate < today;
  // Waiting for a reply (user request 2026-10-07): offered next to Mark complete (and for completed tasks).
  const wait = canWait(task) ? (
    <Button
      onClick={() => {
        onClose();
        openWait(task);
      }}
    >
      <Hourglass size={15} /> {waiting ? "Reply date" : "Wait for reply"}
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className={done ? "text-lg font-semibold text-slate-400 line-through" : "text-lg font-semibold text-ink"}>{task.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <PriorityPill priority={task.priority} />
          {done ? <Badge tone="low">Completed</Badge> : waiting ? <Badge tone="snooze">Waiting for reply</Badge> : overdue ? <Badge tone="urgent">Overdue</Badge> : <Badge>Open</Badge>}
          {task.report ? <Badge tone="info">Reminder</Badge> : task.thread ? <Badge tone="info">From email</Badge> : <Badge>Created by hand</Badge>}
        </div>
      </div>

      <dl className="space-y-2.5 text-sm">
        <Row icon={CalendarDays} label="Due">
          {task.dueDate ? (
            <>
              {formatDay(task.dueDate, today)}
              {task.dueTime && (
                <span className="ml-2 inline-flex items-center gap-1 text-slate-600">
                  <Clock size={13} /> {formatTime(task.dueTime)}
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-500">No due date</span>
          )}
        </Row>
        {waiting && (
          <Row icon={Hourglass} label="Waiting">
            Since {formatWhen(task.waitingSince!)}
            {" · "}
            <span className={cx(waitingText(task, today).tone === "urgent" ? "font-medium text-urgent-ink" : waitingText(task, today).tone === "high" ? "font-medium text-high-ink" : "")}>
              {task.replyBy ? waitingText(task, today).text : "no reply date"}
            </span>
          </Row>
        )}
        {task.report && (
          <Row icon={CalendarClock} label="Reminder">
            {task.report.name} · {task.report.label}
            <LinkChips links={task.report.links} className="mt-1.5" />
          </Row>
        )}
        {task.thread && (
          <Row icon={Mail} label="Email">
            <span className="font-medium">{task.thread.fromName ?? task.thread.fromEmail}</span>: {task.thread.subject}
          </Row>
        )}
        <Row icon={StickyNote} label="Notes">
          {task.notes ? <span className="select-text whitespace-pre-wrap">{task.notes}</span> : <span className="text-slate-500">No notes</span>}
        </Row>
      </dl>

      <ChecklistTicks key={task.id} task={task} />

      <p className="text-xs text-slate-500">
        Created {formatDateTime(task.createdAt)}
        {done && task.completedAt && ` · completed ${formatDateTime(task.completedAt)}`}
      </p>

      {/* Buttons (alignment cleanup, user request 2026-10-06): the main action is a full-width button on phones
          with Open email and Edit side by side under it; wider screens put Open email and Edit on the left and
          the main action on the right. Close is the ✕, a tap outside, or pulling the sheet down. */}
      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className={cx("grid gap-2 sm:flex", task.thread && onOpenEmail ? "grid-cols-2" : "grid-cols-1")}>
          {task.thread && onOpenEmail && (
            <Button onClick={() => onOpenEmail(task.thread!.id)}>
              <Mail size={15} /> Open email
            </Button>
          )}
          <Button onClick={() => onEdit(task)}>
            <Pencil size={15} /> Edit
          </Button>
        </div>
        <div className={cx("grid gap-2 sm:flex", wait ? "grid-cols-2" : "grid-cols-1")}>
          {wait}
          {done ? (
            <Button onClick={() => reopen.mutate(task.id, { onSuccess: onClose })} disabled={reopen.isPending}>
              <RotateCcw size={15} /> Reopen
            </Button>
          ) : (
            <Button variant="primary" onClick={() => complete.mutate(task.id, { onSuccess: onClose })} disabled={complete.isPending}>
              <Check size={15} /> Mark complete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof CalendarDays; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {/* Label lines up with the first line of the value, also when the value wraps (2026-10-06). */}
      <dt className="flex w-20 shrink-0 items-center gap-1.5 leading-5 text-slate-500 sm:w-24">
        <Icon size={15} className="shrink-0" /> {label}
      </dt>
      <dd className="min-w-0 flex-1 leading-5 text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
