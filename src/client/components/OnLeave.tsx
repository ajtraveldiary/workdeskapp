// On leave (user request 2026-10-30, docs/LEAVE_PLAN.md phase 2), on the Employees page after Joining & relieving:
// one line until its title is clicked ("· 2 on leave · 1 due back"), with Mark leave. Open, it lists the leaves that
// matter now: on leave today, due back (the leave is over but no joining report yet), and starting within 30 days,
// each with its paperwork steps; tapping one edits it (rejoined, cancel). OnLeaveTag marks their rows.
import { useState } from "react";
import { CalendarOff, CalendarPlus, ChevronDown } from "lucide-react";
import type { EmployeeLeave, StaffList, Task } from "../../shared/types";
import { useCurrentLeaves, useLeaveTypes } from "../api";
import { Button, Card, cx } from "./ui";
import { LeaveRow, leaveState } from "./LeaveAccount";
import { LeaveDialog, type LeaveFormState } from "./LeaveDialog";
import { TaskDetails } from "./TaskDetails";
import { TaskDialog, type TaskDialogMode } from "./TaskDialog";

const ORDER = ["Due back", "On leave", "Upcoming"];

export function OnLeaveCard({ staff }: { staff: StaffList }) {
  const { data } = useCurrentLeaves();
  const types = useLeaveTypes().data?.types ?? [];
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<LeaveFormState>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState<TaskDialogMode | null>(null);
  const today = data?.today ?? "";
  const leaves = (data?.leaves ?? [])
    .map((l) => ({ l, state: leaveState(l, today) }))
    .filter((x) => ORDER.includes(x.state.label))
    .sort((a, b) => ORDER.indexOf(a.state.label) - ORDER.indexOf(b.state.label) || a.l.fromDate.localeCompare(b.l.fromDate));
  const count = (label: string) => leaves.filter((x) => x.state.label === label).length;
  const summary = [count("On leave") && `${count("On leave")} on leave`, count("Due back") && `${count("Due back")} due back`, count("Upcoming") && `${count("Upcoming")} starting soon`].filter(Boolean).join(" · ");
  const name = (l: EmployeeLeave) => staff.employees.find((e) => e.id === l.employeeId)?.name ?? "Employee";
  if (types.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <div className={cx("flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5", expanded && "border-b border-line")}>
        <h2 className="min-w-0 flex-1">
          <button type="button" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded} className="group/title flex max-w-full items-center gap-2 text-left font-semibold text-ink active:scale-[0.98]">
            <CalendarOff size={17} className="shrink-0 text-brand-700" />
            <span className="group-hover/title:text-brand-700">On leave</span>
            {summary && <span className="truncate text-footnote font-normal text-slate-500">· {summary}</span>}
            <ChevronDown size={16} className={cx("shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
        </h2>
        <Button size="sm" variant="primary" onClick={() => setForm({})}>
          <CalendarPlus size={15} /> Mark leave
        </Button>
      </div>
      {expanded &&
        (leaves.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">No one is on leave, due back or starting leave in the next 30 days.</p>
        ) : (
          <ul className="divide-y divide-line">
            {leaves.map(({ l }) => (
              <LeaveRow key={l.id} leave={l} who={name(l)} type={types.find((t) => t.id === l.typeId)} today={today} onOpen={() => setForm({ leave: l })} onTask={setTask} />
            ))}
          </ul>
        ))}
      <LeaveDialog state={form} onClose={() => setForm(null)} />
      <TaskDetails
        task={task}
        onClose={() => setTask(null)}
        onEdit={(t) => {
          setTask(null);
          setTaskForm({ kind: "edit", task: t });
        }}
      />
      <TaskDialog mode={taskForm} onClose={() => setTaskForm(null)} />
    </Card>
  );
}

// "On leave" on an employee's row while they are on leave today.
export function OnLeaveTag({ id, className }: { id: string; className?: string }) {
  const { data } = useCurrentLeaves();
  if (!data || !data.leaves.some((l) => l.employeeId === id && leaveState(l, data.today).label === "On leave")) return null;
  return <span className={cx("inline-flex shrink-0 items-center rounded-full bg-brand-100 px-2 py-0.5 text-caption font-medium text-brand-800", className)}>On leave</span>;
}
