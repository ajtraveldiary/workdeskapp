// Read-only view of a task, with what was entered when it was created. Opened from task lists; for a task
// made from an email it also names the email, and its title opens it (onOpenEmail).
import { CalendarDays, Check, Clock, CalendarClock, FileClock, Hourglass, Mail, Pencil, RotateCcw, StickyNote, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Task } from "../../shared/types";
import { useCompleteTask, useMe, useReopenTask, useUpdateTask } from "../api";
import { formatDateTime, formatDay, formatTime, formatWhen } from "../format";
import { ChecklistTicks } from "./Checklist";
import { LinkChips } from "./ReminderLinks";
import { canWait, isWaiting, openWait, waitingText } from "./Waiting";
import { RelatedLine, type RelatedValue } from "./Related";
import { isContractTask, openContract } from "./ContractChooser";
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
  const update = useUpdateTask();
  // Shown straight away: the card holds the task as it was when opened.
  const [related, setRelated] = useState<RelatedValue>({ relatedKind: task.relatedKind, relatedId: task.relatedId });
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
        {/* For an email task the title opens the email (user request 2026-10-07, replacing the Open email button). */}
        {task.thread && onOpenEmail ? (
          <h3 className="text-lg font-semibold">
            <button
              type="button"
              onClick={() => onOpenEmail(task.thread!.id)}
              title="Open email"
              className={cx(
                "group/open text-left [overflow-wrap:anywhere] hover:text-brand-700 hover:underline active:opacity-70",
                done ? "text-slate-400 line-through" : "text-ink",
              )}
            >
              {task.title}
              <Mail size={15} className="ml-1.5 inline-block align-[-1px] text-slate-400 group-hover/open:text-brand-600" aria-hidden />
              <span className="sr-only">, open email</span>
            </button>
          </h3>
        ) : (
          <h3 className={cx("text-lg font-semibold [overflow-wrap:anywhere]", done ? "text-slate-400 line-through" : "text-ink")}>{task.title}</h3>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <PriorityPill priority={task.priority} />
          {done ? <Badge tone="low">Completed</Badge> : waiting ? <Badge tone="snooze">Waiting for reply</Badge> : overdue ? <Badge tone="urgent">Overdue</Badge> : <Badge>Open</Badge>}
          {task.report ? (
            <Badge tone="info">Reminder</Badge>
          ) : task.thread ? (
            <Badge tone="info">From email</Badge>
          ) : task.madeBySystem ? (
            // Made by WorkDesk itself, e.g. Pension papers (user request 2026-10-08).
            <Badge tone="info">Made by system</Badge>
          ) : (
            <Badge>Created by hand</Badge>
          )}
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
        {/* What the task is about (Staff, user request 2026-10-07): changed here straight away. */}
        <Row icon={UserRound} label="For">
          <RelatedLine
            value={related}
            busy={update.isPending}
            onChange={(v) => {
              const before = related;
              setRelated(v);
              update.mutate({ id: task.id, input: v }, { onError: () => setRelated(before) });
            }}
          />
        </Row>
        <Row icon={StickyNote} label="Notes">
          {task.notes ? <span className="select-text whitespace-pre-wrap">{task.notes}</span> : <span className="text-slate-500">No notes</span>}
        </Row>
      </dl>

      <ChecklistTicks key={task.id} task={task} />

      <p className="text-xs text-slate-500">
        Created {formatDateTime(task.createdAt)}
        {done && task.completedAt && ` · completed ${formatDateTime(task.completedAt)}`}
      </p>

      {/* Buttons on one line (user request 2026-10-07): Edit on the left, Wait for reply and the main action on
          the right; on phones the three share the width. No Open email button: the title opens the email. They
          only wrap when they can't fit. Close is the ✕, a tap outside, or pulling the sheet down. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 max-sm:[&>button]:flex-1 max-sm:[&>button]:px-2">
        <Button onClick={() => onEdit(task)} className="sm:mr-auto">
          <Pencil size={15} /> Edit
        </Button>
        {wait}
        {done ? (
          <Button onClick={() => reopen.mutate(task.id, { onSuccess: onClose })} disabled={reopen.isPending}>
            <RotateCcw size={15} /> Reopen
          </Button>
        ) : isContractTask(task) ? (
          // A "Contract ends" task asks Renew or Contract ended instead (user request 2026-10-08).
          <Button variant="primary" onClick={() => openContract(task, onClose)}>
            <FileClock size={15} /> Renew or end
          </Button>
        ) : (
          <Button variant="primary" onClick={() => complete.mutate(task.id, { onSuccess: onClose })} disabled={complete.isPending}>
            <Check size={15} /> Mark complete
          </Button>
        )}
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
