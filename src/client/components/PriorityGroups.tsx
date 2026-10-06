// Task lists grouped by priority (user request 2026-10-06): rows no longer show a priority badge; instead the
// list runs Urgent → High → Medium → Low under coloured headings, and each row keeps a bar in its group's
// colour. Within a group: earliest due first (so overdue leads), then by time, undated last.
import { Fragment, type ReactNode } from "react";
import type { Priority, Task } from "../../shared/types";
import { PRIORITY_TONE, TONE, cx } from "./ui";

const ORDER: Priority[] = ["urgent", "high", "normal", "low"];
const TITLE: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Medium", low: "Low" };

const byDue = (a: Task, b: Task) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || a.title.localeCompare(b.title);

export function priorityGroups(tasks: Task[]) {
  return ORDER.map((priority) => ({ priority, tasks: tasks.filter((t) => t.priority === priority).sort(byDue) })).filter((g) => g.tasks.length > 0);
}

// Renders the headings and rows inside a <ul>; `edge` lets the heading span the list's padding like the rows do.
export function PriorityGrouped({ tasks, edge, children }: { tasks: Task[]; edge?: string; children: (t: Task) => ReactNode }) {
  return (
    <>
      {priorityGroups(tasks).map((g) => (
        <Fragment key={g.priority}>
          <li className={cx("flex items-center gap-2 py-1 text-[0.6875rem] font-semibold tracking-wide uppercase", TONE[PRIORITY_TONE[g.priority]].soft, edge)}>
            <span className={cx("size-2 rounded-full", TONE[PRIORITY_TONE[g.priority]].dot)} aria-hidden />
            {TITLE[g.priority]}
            <span className="font-medium opacity-70">{g.tasks.length}</span>
          </li>
          {g.tasks.map(children)}
        </Fragment>
      ))}
    </>
  );
}
