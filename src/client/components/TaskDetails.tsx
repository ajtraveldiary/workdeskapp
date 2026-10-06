// Read-only view of a task, with what was entered when it was created. Used for tasks that didn't come
// from an email (made by hand, or by a recurring report).
import { CalendarDays, Check, Clock, FileText, Pencil, RotateCcw, StickyNote, Tag } from "lucide-react";
import type { ReactNode } from "react";
import type { Task } from "../../shared/types";
import { useCompleteTask, useMe, useReopenTask } from "../api";
import { LabelChips } from "./LabelChips";
import { formatDateTime, formatDay, formatTime } from "../format";
import { Badge, Button, Modal, PriorityPill } from "./ui";

export function TaskDetails({ task, onClose, onEdit }: { task: Task | null; onClose: () => void; onEdit: (t: Task) => void }) {
  return (
    <Modal open={task !== null} onClose={onClose} title="Task details">
      {task && <Details task={task} onClose={onClose} onEdit={onEdit} />}
    </Modal>
  );
}

function Details({ task, onClose, onEdit }: { task: Task; onClose: () => void; onEdit: (t: Task) => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const done = task.status === "done";
  const overdue = !done && !!task.dueDate && task.dueDate < today;

  return (
    <div className="space-y-4">
      <div>
        <h3 className={done ? "text-lg font-semibold text-slate-400 line-through" : "text-lg font-semibold text-ink"}>{task.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <PriorityPill priority={task.priority} />
          {done ? <Badge tone="low">Completed</Badge> : overdue ? <Badge tone="urgent">Overdue</Badge> : <Badge>Open</Badge>}
          {task.report ? <Badge tone="info">Recurring report</Badge> : <Badge>Created by hand</Badge>}
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
        <Row icon={Tag} label="Labels">
          {task.labelIds?.length ? <LabelChips ids={task.labelIds} max={8} /> : <span className="text-slate-500">None</span>}
        </Row>
        {task.report && (
          <Row icon={FileText} label="Report">
            {task.report.name} · {task.report.label}
          </Row>
        )}
        <Row icon={StickyNote} label="Notes">
          {task.notes ? <span className="whitespace-pre-wrap">{task.notes}</span> : <span className="text-slate-500">No notes</span>}
        </Row>
      </dl>

      <p className="text-xs text-slate-500">
        Created {formatDateTime(task.createdAt)}
        {done && task.completedAt && ` · completed ${formatDateTime(task.completedAt)}`}
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => onEdit(task)}>
          <Pencil size={15} /> Edit
        </Button>
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
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof CalendarDays; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-slate-500">
        <Icon size={15} /> {label}
      </dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}
