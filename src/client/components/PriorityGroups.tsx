// Task lists in priority order (user request 2026-10-06): rows show no priority badge and the lists have no
// group headings (user request 2026-10-06: the colour bar is enough). Tasks run Urgent → High → Medium → Low,
// each row keeping a bar in its priority's colour; within a priority, earliest due first (so overdue leads),
// then by time, undated last.
import type { ReactNode } from "react";
import type { Priority, Task } from "../../shared/types";

const ORDER: Priority[] = ["urgent", "high", "normal", "low"];

const byDue = (a: Task, b: Task) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || a.title.localeCompare(b.title);

export const byPriority = (tasks: Task[]) => [...tasks].sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority) || byDue(a, b));

// Renders the rows of a <ul> in priority order.
export function PriorityGrouped({ tasks, children }: { tasks: Task[]; children: (t: Task) => ReactNode }) {
  return <>{byPriority(tasks).map(children)}</>;
}
