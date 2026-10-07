// Settings > Employees (user request 2026-10-07: "add a section in settings for employees, move designation
// editing to there"): the office's designations, which the Employees page groups by and the "For" picker lists.
// Add, rename, move up/down, remove when unused, and add the common Health Services posts.
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, ChevronRight, ListPlus, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import type { Designation, StaffList } from "../../shared/types";
import { COMMON_DESIGNATIONS } from "../../shared/staff";
import { useStaff, useStaffActions } from "../api";
import { Button, Card, ErrorNote, Loading, cx, inputClass } from "./ui";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;


export function EmployeeSettings() {
  const { data, error } = useStaff();
  return (
    <Card className="p-5">
      <h2 id="employees" className="flex scroll-mt-24 items-center gap-2 font-semibold text-slate-900">
        <UsersRound size={18} className="text-brand-700" /> Employees
      </h2>
      <p className="mt-1 text-sm text-slate-600">The designations in your office. The Employees page groups people by them, in this order, and tasks and reminders can be for everyone of a designation.</p>
      <Link to="/employees" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        Open the Employees page <ChevronRight size={15} />
      </Link>
      <h3 className="mt-4 mb-2 text-sm font-medium text-ink">Designations{data ? ` (${data.designations.length})` : ""}</h3>
      {error ? <ErrorNote error={error} /> : !data ? <Loading className="py-4" /> : <Designations staff={data} />}
    </Card>
  );
}

function Designations({ staff }: { staff: StaffList }) {
  const { addDesignation, addCommon, renameDesignation, moveDesignation, removeDesignation } = useStaffActions();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const count = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of staff.employees) if (!e.leftOn && e.designationId) m.set(e.designationId, (m.get(e.designationId) ?? 0) + 1);
    return m;
  }, [staff.employees]);
  const have = new Set(staff.designations.map((d) => d.name.toLowerCase()));
  const missing = COMMON_DESIGNATIONS.filter((n) => !have.has(n.toLowerCase())).length;
  const error = addDesignation.error ?? addCommon.error ?? renameDesignation.error ?? moveDesignation.error ?? removeDesignation.error;

  const add = (ev: FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) return;
    addDesignation.mutate(name.trim(), { onSuccess: () => setName("") });
  };
  const saveRename = (ev: FormEvent) => {
    ev.preventDefault();
    if (editing && editing.name.trim()) renameDesignation.mutate({ id: editing.id, name: editing.name.trim() }, { onSuccess: () => setEditing(null) });
  };
  const remove = (d: Designation) => confirm(`Remove the designation "${d.name}"?`) && removeDesignation.mutate(d.id);

  return (
    <div className="space-y-3">
      {missing > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-footnote text-slate-600">Add the usual Health Services posts (Medical Officer, Staff Nurse, JPHN, Senior Clerk…). You can rename or remove any.</p>
          <Button size="sm" onClick={() => addCommon.mutate()} disabled={addCommon.isPending}>
            <ListPlus size={15} /> Add {missing === COMMON_DESIGNATIONS.length ? "common designations" : `${missing} more common ones`}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-line">
        {staff.designations.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No designations yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {staff.designations.map((d, i) => (
              <li key={d.id} className="flex items-center gap-2 py-1.5 pr-2 pl-3">
                {editing?.id === d.id ? (
                  <form onSubmit={saveRename} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
                    <input className={cx(inputClass, "min-w-0 flex-1")} value={editing.name} onChange={(e) => setEditing({ id: d.id, name: e.target.value })} autoFocus maxLength={80} aria-label="Designation name" />
                    <Button size="sm" type="submit" variant="primary" disabled={renameDesignation.isPending}>
                      Save
                    </Button>
                    <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">
                      {d.name}
                      {count.get(d.id) ? <span className="text-slate-500"> · {plural(count.get(d.id)!, "employee")}</span> : null}
                    </span>
                    <IconButton label={`Move ${d.name} up`} disabled={i === 0} onClick={() => moveDesignation.mutate({ id: d.id, by: -1 })}>
                      <ArrowUp size={16} />
                    </IconButton>
                    <IconButton label={`Move ${d.name} down`} disabled={i === staff.designations.length - 1} onClick={() => moveDesignation.mutate({ id: d.id, by: 1 })}>
                      <ArrowDown size={16} />
                    </IconButton>
                    <IconButton label={`Rename ${d.name}`} onClick={() => setEditing({ id: d.id, name: d.name })}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton label={`Remove ${d.name}`} onClick={() => remove(d)} danger>
                      <Trash2 size={16} />
                    </IconButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex gap-2 border-t border-line bg-slate-50/60 p-2.5">
          <input className={cx(inputClass, "min-w-0 flex-1")} value={name} onChange={(e) => setName(e.target.value)} placeholder="New designation, e.g. Senior Clerk" aria-label="New designation" maxLength={80} />
          <Button type="submit" disabled={!name.trim() || addDesignation.isPending}>
            <Plus size={16} /> Add
          </Button>
        </form>
      </div>
      <ErrorNote error={error} />
      <p className="text-footnote text-slate-500">
        A designation with employees, or linked to a task or reminder, can't be removed; rename it instead.
      </p>
    </div>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx("shrink-0 rounded-md p-1.5 text-slate-500 enabled:hover:bg-slate-100 enabled:active:scale-90 disabled:opacity-30", danger ? "enabled:hover:text-urgent-ink" : "enabled:hover:text-ink")}
    >
      {children}
    </button>
  );
}
