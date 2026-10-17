// Registers (user request 2026-10-16): Settings › Registers (the list of registers), the add / edit entry form, and
// an entry's row. An entry is a pending update to a register; "Needs" is the employee who has to sign it or give
// what is needed. It is a task only when given a due date (then ticking either ticks both).
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { BookOpen, Building2, CalendarDays, Check, ChevronRight, ListPlus, Pencil, Trash2, UserRound } from "lucide-react";
import type { Register, RegisterEntry, StaffList } from "../../shared/types";
import { useEntryActions, useMe, useRegisterActions, useRegisters } from "../api";
import { formatDay } from "../format";
import { NameList } from "./Designations";
import { NO_RELATED, TitleWithRelated } from "./Related";
import { SwipeRow, useSwipeMode } from "./SwipeRow";
import { Button, Card, CheckCircle, ErrorNote, Field, Loading, Modal, cx, inputClass } from "./ui";

export function RegisterSettings() {
  const { data, error } = useRegisters();
  const a = useRegisterActions();
  const counts = new Map((data?.registers ?? []).map((r) => [r.id, r.open]));
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <BookOpen size={18} className="text-brand-700" /> Registers
      </h2>
      <p className="mt-1 text-sm text-slate-600">The registers you keep (service book register, stock register…). Each gets its list of pending updates on the Registers page.</p>
      <Link to="/registers" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        Open the Registers page <ChevronRight size={15} />
      </Link>
      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Loading className="py-4" />
      ) : (
        <NameList
          title="Registers"
          items={data.registers}
          counts={counts}
          unit="pending entry"
          common={[]}
          commonText=""
          commonButton={() => ""}
          placeholder="New register, e.g. Service book register"
          label="register"
          confirmText={(r) => {
            const reg = data.registers.find((x) => x.id === r.id);
            const n = (reg?.open ?? 0) + (reg?.done ?? 0);
            return n ? `Remove the register "${r.name}"? Its ${n} ${n === 1 ? "entry goes" : "entries go"} with it, and their open tasks.` : `Remove the register "${r.name}"?`;
          }}
          footnote="Removing a register removes its entries and their open tasks."
          add={a.add}
          addCommon={a.addCommon}
          rename={a.rename}
          order={a.order}
          remove={a.remove}
        />
      )}
    </Card>
  );
}

export type EntryFormMode = { kind: "new"; registerId?: string } | { kind: "edit"; entry: RegisterEntry };

export function EntryDialog({ mode, onClose }: { mode: EntryFormMode | null; onClose: () => void }) {
  return (
    <Modal open={mode !== null} onClose={onClose} title={mode?.kind === "edit" ? "Edit entry" : "New pending entry"}>
      {mode && <EntryForm key={mode.kind === "edit" ? mode.entry.id : (mode.registerId ?? "new")} mode={mode} onDone={onClose} />}
    </Modal>
  );
}

function EntryForm({ mode, onDone }: { mode: EntryFormMode; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const registers = useRegisters().data?.registers ?? [];
  const { add, save, remove } = useEntryActions();
  const e = mode.kind === "edit" ? mode.entry : null;
  const [registerId, setRegisterId] = useState(e?.registerId ?? (mode.kind === "new" ? mode.registerId : undefined) ?? registers[0]?.id ?? "");
  const [text, setText] = useState(e?.text ?? "");
  const [employeeId, setEmployeeId] = useState(e?.employeeId ?? "");
  // "Add a task with a due date": only then does it show in To-do and Due Today (user request 2026-10-16).
  const [withTask, setWithTask] = useState(!!e?.task);
  const [dueDate, setDueDate] = useState(e?.task?.dueDate ?? today);
  const busy = add.isPending || save.isPending || remove.isPending;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const input = { registerId, text, employeeId: employeeId || null, dueDate: withTask ? dueDate || today : null };
    try {
      if (e) await save.mutateAsync({ id: e.id, input });
      else await add.mutateAsync(input);
      onDone();
    } catch {
      // shown below
    }
  };
  const del = () => {
    if (!e || !confirm(`Remove this entry?${e.task?.status === "open" ? " Its task goes too." : ""}`)) return;
    remove.mutate(e.id, { onSuccess: onDone });
  };

  if (!registers.length)
    return (
      <p className="text-sm text-slate-600">
        Add your registers first in{" "}
        <Link to="/settings#registers" onClick={onDone} className="font-medium text-brand-700 hover:underline">
          Settings › Registers
        </Link>
        .
      </p>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Register">
        <select className={inputClass} value={registerId} onChange={(x) => setRegisterId(x.target.value)} required>
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What needs updating">
        {/* Who is needed: the person button inside the box, as in the task and reminder forms (user request
            2026-10-16); one employee only. */}
        <TitleWithRelated
          value={employeeId ? { relatedKind: "employee", relatedId: employeeId } : NO_RELATED}
          onChange={(v) => setEmployeeId(v.relatedKind === "employee" && v.relatedId ? v.relatedId : "")}
          employeesOnly={{ title: "Who has to sign or give information?", prefix: "Needs" }}
        >
          <input className={inputClass} value={text} onChange={(x) => setText(x.target.value)} required maxLength={500} autoFocus={!e} placeholder="e.g. Enter increment sanctioned in October" />
        </TitleWithRelated>
      </Field>
      <div className="rounded-lg border border-line p-3">
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={withTask} onChange={(x) => setWithTask(x.target.checked)} className="size-4 accent-brand-600" />
          <CalendarDays size={16} className="text-brand-700" /> Add a task with a due date
        </label>
        {withTask ? (
          <div className="mt-2 pl-6">
            <input type="date" className={cx(inputClass, "w-auto!")} value={dueDate} onChange={(x) => setDueDate(x.target.value)} required aria-label="Due date" />
          </div>
        ) : (
          <p className="mt-1 pl-6 text-footnote text-slate-500">Without one it stays only in the register, not in To-do or Due Today.</p>
        )}
      </div>
      <ErrorNote error={add.error ?? save.error ?? remove.error} />
      <div className="flex flex-wrap items-center gap-2">
        {e && (
          <Button type="button" variant="danger" onClick={del} disabled={busy} aria-label="Remove entry" title="Remove">
            <Trash2 size={15} />
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onDone} className="ml-auto">
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !registerId}>
          {e ? <Check size={16} /> : <ListPlus size={16} />} {e ? "Save" : "Add entry"}
        </Button>
      </div>
    </form>
  );
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// One entry: tick circle, what to update, the register (in the all-entries list), who is needed and its task's due date.
export function EntryRow({ entry: e, registers, staff, showRegister, onEdit }: { entry: RegisterEntry; registers: Register[]; staff: StaffList | undefined; showRegister: boolean; onEdit: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const swipe = useSwipeMode();
  const { done, remove } = useEntryActions();
  const isDone = e.status === "done";
  const person = staff?.employees.find((x) => x.id === e.employeeId)?.name;
  const reg = registers.find((r) => r.id === e.registerId)?.name;
  const overdue = !isDone && !!e.task?.dueDate && e.task.dueDate < today;
  const toggle = () => done.mutate({ id: e.id, done: !isDone });
  return (
    <SwipeRow
      contentClassName="row-click flex items-start gap-3 px-4 py-2.5 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5"
      leading={{ label: isDone ? "Reopen" : "Done", icon: Check, tone: isDone ? "neutral" : "low", onClick: toggle }}
      trailing={[
        { label: "Edit", icon: Pencil, tone: "neutral", onClick: onEdit },
        { label: "Remove", icon: Trash2, tone: "urgent", onClick: () => confirm("Remove this entry?") && remove.mutate(e.id) },
      ]}
    >
      {!swipe && <CheckCircle checked={isDone} onToggle={toggle} label={isDone ? `Mark pending: ${e.text}` : `Mark done: ${e.text}`} />}
      <div className="min-w-0 flex-1">
        <button onClick={onEdit} className="row-link group/title block w-full text-left">
          <span className={cx("text-subhead leading-snug [overflow-wrap:anywhere]", isDone ? "text-slate-400" : "text-ink group-hover/title:text-brand-700")}>{e.text}</span>
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-slate-500">
          {showRegister && reg && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <BookOpen size={12} className="shrink-0" />
              <span className="truncate">{reg}</span>
            </span>
          )}
          {/* No one assigned: "General" (user request 2026-10-17). */}
          <span className="inline-flex min-w-0 items-center gap-1">
            {person ? <UserRound size={12} className="shrink-0" /> : <Building2 size={12} className="shrink-0" />}
            <span className="truncate">{person ?? "General"}</span>
          </span>
          {e.task?.dueDate && !isDone && (
            <span className={cx("inline-flex items-center gap-1", overdue && "font-medium text-urgent-ink")}>
              <CalendarDays size={12} /> Due {formatDay(e.task.dueDate, today)}
            </span>
          )}
          {isDone && e.doneAt && <span className="text-low-ink">Done {shortDay(e.doneAt)}</span>}
        </div>
      </div>
    </SwipeRow>
  );
}
