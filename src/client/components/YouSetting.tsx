// Settings > Employees, "You" (user request 2026-10-12, "one of the employees is the user"): which employee the
// person using WorkDesk is. Saved at once; their row and page show a "You" tag.
import { Link } from "react-router";
import { ChevronRight, UserRound } from "lucide-react";
import { useMe, useSetMeEmployee, useStaff } from "../api";
import { Card, ErrorNote, Loading, cx, inputClass } from "./ui";

export function YouSetting() {
  const me = useMe().data;
  const staff = useStaff().data;
  const save = useSetMeEmployee();
  const current = me?.employeeId ?? null;
  const people = staff?.employees ?? [];
  const mine = people.find((e) => e.id === current);
  // Employees still in the office (and the chosen one even if they have left), by designation in their order.
  const groups = [
    ...(staff?.designations ?? []).map((d) => ({ label: d.name, list: people.filter((e) => e.designationId === d.id) })),
    { label: "No designation", list: people.filter((e) => !e.designationId || !staff?.designations.some((d) => d.id === e.designationId)) },
  ]
    .map((g) => ({ ...g, list: g.list.filter((e) => !e.leftOn || e.id === current).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.list.length);
  const designation = mine && staff?.designations.find((d) => d.id === mine.designationId)?.name;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <UserRound size={18} className="text-brand-700" /> You
      </h2>
      <p className="mt-1 text-sm text-slate-600">Which employee you are. Your row and page in Employees show a “You” tag.</p>
      {!me || !staff ? (
        <Loading className="py-4" />
      ) : people.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No employees yet.{" "}
          <Link to="/employees" className="font-medium text-brand-700 hover:underline">
            Add yourself on the Employees page
          </Link>
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <select
            className={cx(inputClass, "max-w-md")}
            value={current ?? ""}
            onChange={(ev) => save.mutate(ev.target.value || null)}
            disabled={save.isPending}
            aria-label="Which employee you are"
          >
            <option value="">Not chosen</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.list.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {mine && (
            <Link to={`/employees/${mine.id}`} className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              <span className="truncate">
                Open your page{designation ? ` (${designation})` : ""}
              </span>
              <ChevronRight size={15} className="shrink-0" />
            </Link>
          )}
          <ErrorNote error={save.error} />
        </div>
      )}
    </Card>
  );
}
