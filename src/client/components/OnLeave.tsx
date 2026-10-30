// "On leave" tag on the Employees list and table rows (user request 2026-10-30). The On leave card that was on the
// Employees page moved to the Leave page (user request 2026-10-31: leave on its own page), whose history shows the
// state of every leave.
import { useCurrentLeaves } from "../api";
import { cx } from "./ui";
import { leaveState } from "./LeaveAccount";

// "On leave" on an employee's row while they are on leave today.
export function OnLeaveTag({ id, className }: { id: string; className?: string }) {
  const { data } = useCurrentLeaves();
  if (!data || !data.leaves.some((l) => l.employeeId === id && leaveState(l, data.today).label === "On leave")) return null;
  return <span className={cx("inline-flex shrink-0 items-center rounded-full bg-brand-100 px-2 py-0.5 text-caption font-medium text-brand-800", className)}>On leave</span>;
}
