// Registers page (user request 2026-10-16): split in two halves (stacked on phones). One half lists every register's
// pending entries together, filtered by the employee needed and by register, with Show done; the other is a card
// per register, one line until clicked (name, pending count, the date it is updated until), opening to its own
// to-do list, its "Updated until" date and Add entry. Registers are added in Settings › Registers.
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { BookOpen, ChevronDown, ListPlus, Plus } from "lucide-react";
import type { Register, RegisterEntry, StaffList } from "../../shared/types";
import { useEntryActions, useMe, useRegisterActions, useRegisterEntries, useRegisters, useStaff } from "../api";
import { EntryDialog, EntryRow, type EntryFormMode } from "../components/Registers";
import { RefreshButton } from "../components/RefreshButton";
import { Button, Card, ErrorNote, Fab, PageHeader, SkeletonList, cx, inputClass } from "../components/ui";

const fullDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function RegistersPage() {
  const regs = useRegisters().data?.registers;
  const entries = useRegisterEntries().data?.entries;
  const staff = useStaff().data;
  const [form, setForm] = useState<EntryFormMode | null>(null);
  const [person, setPerson] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [showDone, setShowDone] = useState(false);

  // People the entries need, for the filter, with how many pending entries need each.
  const people = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of entries ?? []) if (e.employeeId) n.set(e.employeeId, (n.get(e.employeeId) ?? 0) + (e.status === "open" ? 1 : 0));
    return [...n.entries()]
      .map(([id, open]) => ({ id, open, name: staff?.employees.find((x) => x.id === id)?.name ?? "Employee" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, staff]);
  const matching = (entries ?? []).filter((e) => (!person || e.employeeId === person) && (!registerId || e.registerId === registerId));
  const list = matching.filter((e) => showDone || e.status === "open");
  const doneCount = matching.filter((e) => e.status === "done").length;
  const order = new Map((regs ?? []).map((r, i) => [r.id, i]));
  list.sort((a, b) => (a.status === b.status ? (order.get(a.registerId) ?? 0) - (order.get(b.registerId) ?? 0) : a.status === "open" ? -1 : 1));

  return (
    <>
      <PageHeader
        title="Registers"
        subtitle="Pending updates to the office's registers, and who has to sign or give information for each. Add registers in Settings."
        actions={
          <>
            <RefreshButton keys={[["registers"], ["register-entries"]]} label="Refresh registers" />
            <Button variant="primary" onClick={() => setForm({ kind: "new" })} className="max-sm:hidden">
              <ListPlus size={17} /> New entry
            </Button>
          </>
        }
      />
      <Fab label="New entry" onClick={() => setForm({ kind: "new" })} />
      {!regs || !entries ? (
        <SkeletonList rows={5} />
      ) : regs.length === 0 ? (
        <Card className="px-5 py-10 text-center">
          <BookOpen size={28} className="mx-auto text-brand-600" />
          <p className="mt-2 font-medium text-ink">No registers yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Add the registers you keep in{" "}
            <Link to="/settings#registers" className="font-medium text-brand-700 hover:underline">
              Settings › Registers
            </Link>
            .
          </p>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* Every register's entries together. */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5">
              <h2 className="flex-1 font-semibold text-ink">Pending entries ({matching.filter((e) => e.status === "open").length})</h2>
              {doneCount > 0 && (
                <label className="flex items-center gap-2 text-footnote text-slate-600">
                  <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-4 accent-brand-600" />
                  Show done ({doneCount})
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pt-3 sm:px-5">
              <select className={inputClass} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by employee">
                <option value="">Everyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.open ? ` (${p.open})` : ""}
                  </option>
                ))}
              </select>
              <select className={inputClass} value={registerId} onChange={(e) => setRegisterId(e.target.value)} aria-label="Filter by register">
                <option value="">All registers</option>
                {regs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 sm:px-5">{person || registerId ? "Nothing pending here." : "Nothing pending. Use New entry to note an update a register needs."}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line border-t border-line">
                {list.map((e) => (
                  <EntryRow key={e.id} entry={e} registers={regs} staff={staff} showRegister={!registerId} onEdit={() => setForm({ kind: "edit", entry: e })} />
                ))}
              </ul>
            )}
          </Card>

          {/* A card per register, one line until clicked. */}
          <div className="space-y-3">
            {regs.map((r) => (
              <RegisterCard key={r.id} register={r} entries={entries.filter((e) => e.registerId === r.id)} registers={regs} staff={staff} onForm={setForm} />
            ))}
          </div>
        </div>
      )}
      <EntryDialog mode={form} onClose={() => setForm(null)} />
    </>
  );
}

function RegisterCard({
  register: r,
  entries,
  registers,
  staff,
  onForm,
}: {
  register: Register;
  entries: RegisterEntry[];
  registers: Register[];
  staff: StaffList | undefined;
  onForm: (m: EntryFormMode) => void;
}) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { updatedUntil } = useRegisterActions();
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const pending = entries.filter((e) => e.status === "open");
  const done = entries.filter((e) => e.status === "done");
  const shown = showDone ? [...pending, ...done] : pending;
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="group/title flex w-full items-center gap-2 px-4 py-2.5 text-left active:bg-slate-50 sm:px-5">
        <BookOpen size={16} className="shrink-0 text-brand-700" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink [overflow-wrap:anywhere] group-hover/title:text-brand-700">{r.name}</span>
          <span className="block text-footnote text-slate-500">
            {pending.length ? `${pending.length} pending` : "Nothing pending"}
            {r.updatedUntil ? ` · updated until ${fullDate(r.updatedUntil)}` : ""}
          </span>
        </span>
        <ChevronDown size={16} className={cx("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line">
          {/* The date the register is written up to (user request 2026-10-16). */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:px-5">
            <span className="text-slate-600">Updated until</span>
            <input
              type="date"
              className={cx(inputClass, "h-8 w-auto! pointer-coarse:h-9")}
              value={r.updatedUntil ?? ""}
              onChange={(e) => updatedUntil.mutate({ id: r.id, date: e.target.value || null })}
              aria-label={`${r.name} updated until`}
            />
            {r.updatedUntil !== today && (
              <Button size="sm" onClick={() => updatedUntil.mutate({ id: r.id, date: today })}>
                Today
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => onForm({ kind: "new", registerId: r.id })} className="ml-auto">
              <ListPlus size={15} /> Add entry
            </Button>
          </div>
          <QuickAdd registerId={r.id} registerName={r.name} />
          {shown.length === 0 ? (
            <p className="border-t border-line px-4 py-4 text-sm text-slate-500 sm:px-5">No pending updates.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {shown.map((e) => (
                <EntryRow key={e.id} entry={e} registers={registers} staff={staff} showRegister={false} onEdit={() => onForm({ kind: "edit", entry: e })} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <button type="button" onClick={() => setShowDone((x) => !x)} className="w-full border-t border-line px-4 py-2 text-left text-footnote font-medium text-brand-700 hover:bg-slate-50 sm:px-5">
              {showDone ? "Hide done" : `Show done (${done.length})`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

// Quick add (user request 2026-10-17): type a pending entry and press Enter to record it in this register; who is
// needed and a due date can be added by tapping the entry (or with Add entry).
function QuickAdd({ registerId, registerName }: { registerId: string; registerName: string }) {
  const { add } = useEntryActions();
  const [text, setText] = useState("");
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const t = text.trim();
    if (!t) return;
    add.mutate({ registerId, text: t }, { onSuccess: () => setText("") });
  };
  return (
    <form onSubmit={submit} className="border-t border-line px-4 py-2 sm:px-5">
      <div className="flex gap-2">
        <input
          className={cx(inputClass, "min-w-0 flex-1")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Add a pending entry…"
          aria-label={`New pending entry in ${registerName}`}
          enterKeyHint="done"
        />
        <Button type="submit" disabled={!text.trim() || add.isPending} aria-label="Add" title="Add">
          <Plus size={16} />
        </Button>
      </div>
      <ErrorNote error={add.error} />
    </form>
  );
}
