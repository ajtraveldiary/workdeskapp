import { Check, ExternalLink, Mail, RotateCcw } from "lucide-react";
import type { Category, Task } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useCompleteTask, useMarkSeen, useReopenTask } from "../api";
import { daysBetween, formatDateTime, formatDay } from "../format";
import { Badge, cx } from "./ui";

export function TaskRow({
  task,
  today,
  categories,
  onEdit,
}: {
  task: Task;
  today: string;
  categories: Category[];
  onEdit: (t: Task) => void;
}) {
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const seen = useMarkSeen();
  const done = task.status === "done";
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const category = categories.find((c) => c.id === task.categoryId);
  const gmailUrl = task.thread && gmailThreadUrl(task.thread.accountEmail, task.thread.gmailThreadId);

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <button
        onClick={() => (done ? reopen.mutate(task.id) : complete.mutate(task.id))}
        disabled={complete.isPending || reopen.isPending}
        aria-label={done ? "Reopen task" : "Mark task complete"}
        title={done ? "Reopen" : "Mark complete"}
        className={cx(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          done ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-transparent hover:border-brand-600 hover:text-brand-600",
        )}
      >
        <Check size={12} strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <button onClick={() => onEdit(task)} className="text-left">
          <span className={cx("font-medium", done ? "text-slate-500 line-through" : "text-slate-900")}>{task.title}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {task.dueDate && !done && (
            <Badge tone={overdue ? "red" : task.dueDate === today ? "amber" : "slate"}>
              {overdue ? `Overdue ${daysBetween(task.dueDate, today)}d · ${formatDay(task.dueDate, today)}` : `Due ${formatDay(task.dueDate, today)}`}
            </Badge>
          )}
          {(task.priority === "high" || task.priority === "urgent") && (
            <Badge tone={task.priority === "urgent" ? "red" : "amber"}>{task.priority === "urgent" ? "Urgent" : "High"}</Badge>
          )}
          {category && <Badge>{category.name}</Badge>}
          {done && task.completedAt && <span>Completed {formatDateTime(task.completedAt)}</span>}
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
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800">
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

      {gmailUrl && (
        <a
          href={gmailUrl}
          target="_blank"
          rel="noreferrer"
          title="Open email in Gmail"
          className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <ExternalLink size={16} />
        </a>
      )}
      {done && (
        <button
          onClick={() => reopen.mutate(task.id)}
          title="Reopen"
          className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <RotateCcw size={16} />
        </button>
      )}
    </li>
  );
}
