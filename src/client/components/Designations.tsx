// Settings > Employees (user request 2026-10-07: "add a section in settings for employees, move designation
// editing to there"): the office's designations, which the Employees page groups by and the "For" picker lists,
// and the types of temporary employees (HMC, NHM, Block Panchayath Project…, user request 2026-10-07). Both
// lists: add, rename, move up/down, remove when unused, and add the usual ones in one tap.
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, ChevronRight, ListPlus, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import type { StaffList } from "../../shared/types";
import { COMMON_DESIGNATIONS, COMMON_EMPLOYEE_TYPES } from "../../shared/staff";
import { useStaff, useStaffActions } from "../api";
import { Button, Card, ErrorNote, Loading, cx, inputClass } from "./ui";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function EmployeeSettings() {
  const { data, error } = useStaff();
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <UsersRound size={18} className="text-brand-700" /> Employees
      </h2>
      <p className="mt-1 text-sm text-slate-600">The designations in your office and the types of temporary employees. The Employees page groups people by designation, in this order, and tasks and reminders can be for everyone of a designation.</p>
      <Link to="/employees" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        Open the Employees page <ChevronRight size={15} />
      </Link>
      {error ? <ErrorNote error={error} /> : !data ? <Loading className="py-4" /> : <Lists staff={data} />}
    </Card>
  );
}

function Lists({ staff }: { staff: StaffList }) {
  const a = useStaffActions();
  // How many employees still here have each designation / type.
  const counts = useMemo(() => {
    const d = new Map<string, number>();
    const t = new Map<string, number>();
    for (const e of staff.employees) {
      if (e.leftOn) continue;
      if (e.designationId) d.set(e.designationId, (d.get(e.designationId) ?? 0) + 1);
      if (e.typeId && !e.permanent) t.set(e.typeId, (t.get(e.typeId) ?? 0) + 1);
    }
    return { d, t };
  }, [staff.employees]);
  return (
    <>
      <NameList
        title="Designations"
        items={staff.designations}
        counts={counts.d}
        common={COMMON_DESIGNATIONS}
        commonText="Add the usual Health Services posts (Medical Officer, Staff Nurse, JPHN, Senior Clerk…). You can rename or remove any."
        commonButton={(n, all) => (all ? "Add common designations" : `Add ${n} more common ones`)}
        placeholder="New designation, e.g. Senior Clerk"
        label="designation"
        footnote="A designation with employees, or linked to a task or reminder, can't be removed; rename it instead."
        add={a.addDesignation}
        addCommon={a.addCommon}
        rename={a.renameDesignation}
        move={a.moveDesignation}
        remove={a.removeDesignation}
      />
      <NameList
        title="Types of temporary employees"
        items={staff.types}
        counts={counts.t}
        common={COMMON_EMPLOYEE_TYPES}
        commonText="Add HMC, NHM, Block Panchayath Project and Gramapanchayath Project. You can rename or remove any."
        commonButton={(n, all) => (all ? "Add these types" : `Add ${n} more`)}
        placeholder="New type, e.g. KASP"
        label="type"
        footnote="Chosen in the form of a temporary employee. A type an employee has can't be removed; rename it instead."
        add={a.addType}
        addCommon={a.addCommonTypes}
        rename={a.renameType}
        move={a.moveType}
        remove={a.removeType}
      />
    </>
  );
}

type Mut<V> = { mutate: (v: V, o?: { onSuccess?: () => void }) => void; isPending: boolean; error: Error | null };

function NameList(p: {
  title: string;
  items: { id: string; name: string }[];
  counts: Map<string, number>;
  common: string[];
  commonText: string;
  commonButton: (missing: number, all: boolean) => string;
  placeholder: string;
  label: string;
  footnote: string;
  add: Mut<string>;
  addCommon: Mut<void>;
  rename: Mut<{ id: string; name: string }>;
  move: Mut<{ id: string; by: number }>;
  remove: Mut<string>;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const have = new Set(p.items.map((d) => d.name.toLowerCase()));
  const missing = p.common.filter((n) => !have.has(n.toLowerCase())).length;
  const error = p.add.error ?? p.addCommon.error ?? p.rename.error ?? p.move.error ?? p.remove.error;

  const add = (ev: FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) return;
    p.add.mutate(name.trim(), { onSuccess: () => setName("") });
  };
  const saveRename = (ev: FormEvent) => {
    ev.preventDefault();
    if (editing && editing.name.trim()) p.rename.mutate({ id: editing.id, name: editing.name.trim() }, { onSuccess: () => setEditing(null) });
  };
  const remove = (d: { id: string; name: string }) => confirm(`Remove the ${p.label} "${d.name}"?`) && p.remove.mutate(d.id);

  return (
    <section className="mt-5">
      <h3 className="mb-2 text-sm font-medium text-ink">
        {p.title} ({p.items.length})
      </h3>
      <div className="space-y-3">
        {missing > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="min-w-0 flex-1 text-footnote text-slate-600">{p.commonText}</p>
            <Button size="sm" onClick={() => p.addCommon.mutate()} disabled={p.addCommon.isPending}>
              <ListPlus size={15} /> {p.commonButton(missing, missing === p.common.length)}
            </Button>
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-line">
          {p.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {p.items.map((d, i) => (
                <li key={d.id} className="flex items-center gap-2 py-1.5 pr-2 pl-3">
                  {editing?.id === d.id ? (
                    <form onSubmit={saveRename} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
                      <input className={cx(inputClass, "min-w-0 flex-1")} value={editing.name} onChange={(e) => setEditing({ id: d.id, name: e.target.value })} autoFocus maxLength={80} aria-label={`${p.label} name`} />
                      <Button size="sm" type="submit" variant="primary" disabled={p.rename.isPending}>
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
                        {p.counts.get(d.id) ? <span className="text-slate-500"> · {plural(p.counts.get(d.id)!, "employee")}</span> : null}
                      </span>
                      <IconButton label={`Move ${d.name} up`} disabled={i === 0} onClick={() => p.move.mutate({ id: d.id, by: -1 })}>
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton label={`Move ${d.name} down`} disabled={i === p.items.length - 1} onClick={() => p.move.mutate({ id: d.id, by: 1 })}>
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
            <input className={cx(inputClass, "min-w-0 flex-1")} value={name} onChange={(e) => setName(e.target.value)} placeholder={p.placeholder} aria-label={`New ${p.label}`} maxLength={80} />
            <Button type="submit" disabled={!name.trim() || p.add.isPending}>
              <Plus size={16} /> Add
            </Button>
          </form>
        </div>
        <ErrorNote error={error} />
        <p className="text-footnote text-slate-500">{p.footnote}</p>
      </div>
    </section>
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
