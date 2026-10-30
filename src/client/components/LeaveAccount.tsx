// An employee's leave account (user request 2026-10-30, docs/LEAVE_PLAN.md), on their page: the balance of each
// leave that keeps one (EL, HPL…) and every line of the account, newest first, like the leave account in a service
// book. Lines are only added (opening balance from the service book, a credit, an adjustment), never changed:
// a wrong line is put right with an adjustment. Phase 2: Mark leave, and their leaves with each one's state and
// paperwork steps (tap a leave to edit it, record the rejoining date or cancel it).
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CalendarOff, CalendarPlus, Check, Plus } from "lucide-react";
import type { Employee, EmployeeLeave, LeaveLine, LeaveType, Task } from "../../shared/types";
import { HAND_KINDS, LEDGER_LABEL, SURRENDER_STEPS, daysWord, formatDays, leaveEnd, leaveShort, rejoinDay, type HandKind } from "../../shared/leave";
import { useEmployeeLeaves, useLeaveAccount, useLeaveActions, useLeaveTypes } from "../api";
import { Badge, Button, Card, ErrorNote, Field, Modal, SkeletonList, cx, inputClass, type Tone } from "./ui";
import { ChecklistChip } from "./Checklist";
import { LeaveDialog, type LeaveFormState } from "./LeaveDialog";
import { TaskDetails } from "./TaskDetails";
import { TaskDialog, type TaskDialogMode } from "./TaskDialog";

const fullDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatDays(Math.abs(n))}`;

export function LeaveCard({ employee, today }: { employee: Employee; today: string }) {
  const types = useLeaveTypes().data?.types;
  const account = useLeaveAccount(employee.id);
  const [adding, setAdding] = useState(false);
  const [all, setAll] = useState(false);
  const withAccount = (types ?? []).filter((t) => t.hasAccount);
  const byId = new Map((types ?? []).map((t) => [t.id, t]));
  const lines = account.data?.lines ?? [];
  const shown = all ? lines : lines.slice(0, 8);
  const [leaveForm, setLeaveForm] = useState<LeaveFormState>(null);
  const limited = (types ?? []).filter((t) => t.serviceLimit != null);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center border-b border-line pr-2">
        <h2 className="flex flex-1 items-center gap-2 px-4 py-2.5 text-footnote font-semibold text-slate-600 sm:px-5">
          <CalendarOff size={15} className="text-brand-700" />
          Leave account
        </h2>
        {(types?.length ?? 0) > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setLeaveForm({ employeeId: employee.id })}>
            <CalendarPlus size={15} /> Mark leave
          </Button>
        )}
        {withAccount.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={15} /> Entry
          </Button>
        )}
      </div>
      {!types || account.isLoading ? (
        <SkeletonList rows={2} />
      ) : withAccount.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">
          No leave types yet.{" "}
          <Link to="/settings#leave" className="font-medium text-brand-700 hover:underline">
            Add them in Settings › Leave
          </Link>
        </p>
      ) : (
        <>
          {/* Balance of each leave that keeps one. */}
          <ul className="flex flex-wrap gap-2 px-4 py-3 sm:px-5">
            {withAccount.map((t) => {
              const b = account.data?.balances.find((x) => x.typeId === t.id)?.balance ?? 0;
              return (
                <li key={t.id} className="min-w-16 rounded-lg border border-line px-2.5 py-1.5" title={t.name}>
                  <p className="text-caption text-slate-500">{leaveShort(t)}</p>
                  <p className={cx("text-subhead font-semibold tabular-nums", b < 0 ? "text-urgent-ink" : "text-ink")}>{formatDays(b)}</p>
                </li>
              );
            })}
            {/* Days used against a limit in the whole service (LND 360). */}
            {limited.map((t) => {
              const u = account.data?.used.find((x) => x.typeId === t.id)?.days ?? 0;
              return (
                <li key={t.id} className="min-w-16 rounded-lg border border-dashed border-line px-2.5 py-1.5" title={`${t.name} used in the whole service`}>
                  <p className="text-caption text-slate-500">{leaveShort(t)} used</p>
                  <p className={cx("text-subhead font-semibold tabular-nums", u > t.serviceLimit! ? "text-urgent-ink" : "text-ink")}>
                    {formatDays(u)}
                    <span className="text-footnote font-normal text-slate-500">/{formatDays(t.serviceLimit!)}</span>
                  </p>
                </li>
              );
            })}
          </ul>
          <Leaves employeeId={employee.id} types={types} onOpen={(l) => setLeaveForm({ leave: l })} />
          {lines.length === 0 ? (
            <p className="border-t border-line px-4 py-3 text-footnote text-slate-500 sm:px-5">No entries yet. Start with each leave's opening balance from the service book (Add).</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {shown.map((l) => (
                <LineRow key={l.id} line={l} type={byId.get(l.typeId)} />
              ))}
            </ul>
          )}
          {!all && lines.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="w-full border-t border-line px-4 py-2 text-left text-footnote font-medium text-brand-700 hover:bg-slate-50 sm:px-5">
              Show all {lines.length}
            </button>
          )}
        </>
      )}
      <LeaveDialog state={leaveForm} onClose={() => setLeaveForm(null)} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Leave account entry">
        {adding && <LineForm employee={employee} types={withAccount} balances={account.data?.balances ?? []} today={today} onDone={() => setAdding(false)} />}
      </Modal>
    </Card>
  );
}

// Where a leave stands today.
export function leaveState(l: EmployeeLeave, today: string): { label: string; tone: Tone } {
  if (l.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (l.rejoinedOn && l.rejoinedOn <= today) return { label: "Rejoined", tone: "low" };
  if (today < l.fromDate) return { label: "Upcoming", tone: "info" };
  if (today <= leaveEnd(l)) return { label: "On leave", tone: "brand" };
  return { label: "Due back", tone: "high" };
}
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// "1 Nov – 10 Nov 2026".
export const leaveDates = (l: EmployeeLeave) => (l.fromDate === leaveEnd(l) ? fullDate(l.fromDate) : `${shortDate(l.fromDate)} – ${fullDate(leaveEnd(l))}`);

// Their leaves, newest first (5, then Show all): state, type and days, dates, and the paperwork steps.
function Leaves({ employeeId, types, onOpen }: { employeeId: string; types: LeaveType[]; onOpen: (l: EmployeeLeave) => void }) {
  const { data } = useEmployeeLeaves(employeeId);
  const [all, setAll] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskDialogMode | null>(null);
  const leaves = data?.leaves ?? [];
  if (!data || leaves.length === 0) return null;
  const shown = all ? leaves : leaves.slice(0, 5);
  return (
    <div className="border-t border-line">
      <p className="px-4 pt-2.5 text-caption font-semibold text-slate-500 sm:px-5">Leaves</p>
      <ul className="divide-y divide-line">
        {shown.map((l) => (
          <LeaveRow key={l.id} leave={l} type={types.find((t) => t.id === l.typeId)} today={data.today} onOpen={() => onOpen(l)} onTask={setTask} />
        ))}
      </ul>
      {!all && leaves.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="w-full border-t border-line px-4 py-2 text-left text-footnote font-medium text-brand-700 hover:bg-slate-50 sm:px-5">
          Show all {leaves.length} leaves
        </button>
      )}
      <TaskDetails
        task={task}
        onClose={() => setTask(null)}
        onEdit={(t) => {
          setTask(null);
          setForm({ kind: "edit", task: t });
        }}
      />
      <TaskDialog mode={form} onClose={() => setForm(null)} />
    </div>
  );
}

export function LeaveRow({ leave: l, type, today, onOpen, onTask, who }: { leave: EmployeeLeave; type?: LeaveType; today: string; onOpen: () => void; onTask: (t: Task) => void; who?: string }) {
  const st = leaveState(l, today);
  return (
    <li className={cx("row-click flex items-start gap-3 px-4 py-2 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5", l.status === "cancelled" && "opacity-60")}>
      <button type="button" onClick={onOpen} aria-label={`Open ${who ? `${who}'s ` : ""}${type ? type.name : "leave"}, ${leaveDates(l)}`} className="row-link group/title min-w-0 flex-1 text-left">
        <span className="block text-sm text-ink group-hover/title:text-brand-700 [overflow-wrap:anywhere]">
          {who && <span className="font-medium">{who} · </span>}
          {type ? leaveShort(type) : "Leave"} · {daysWord(l.days)}
        </span>
        <span className="block text-footnote text-slate-500">
          {leaveDates(l)}
          {l.status === "active" && (l.rejoinedOn ? ` · rejoined ${fullDate(l.rejoinedOn)}` : ` · back ${fullDate(rejoinDay(l))}`)}
        </span>
      </button>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={st.tone}>{st.label}</Badge>
        {l.task && (
          <span className="relative z-10 text-footnote">
            <ChecklistChip items={l.task.checklist} onClick={() => onTask(l.task!)} />
          </span>
        )}
      </span>
    </li>
  );
}

function LineRow({ line, type }: { line: LeaveLine; type?: LeaveType }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2 sm:px-5">
      <span className="w-20 shrink-0 pt-px text-footnote text-slate-500 tabular-nums">{fullDate(line.onDate)}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">
          {LEDGER_LABEL[line.kind]} · {type ? leaveShort(type) : "Leave"}
          {line.creditFor && <span className="text-slate-500"> for {line.creditFor}</span>}
        </span>
        {line.note && <span className="block text-footnote text-slate-500 [overflow-wrap:anywhere] select-text">{line.note}</span>}
      </span>
      <span className={cx("shrink-0 text-sm font-medium tabular-nums", line.kind === "opening" ? "text-ink" : line.days < 0 ? "text-urgent-ink" : "text-low-ink")}>
        {line.kind === "opening" ? formatDays(line.days) : signed(line.days)}
      </span>
    </li>
  );
}

// Surrender of earned leave (phase 4) is an entry too, with its own task.
type EntryKind = HandKind | "surrender";
const ENTRY_KINDS: EntryKind[] = [...HAND_KINDS, "surrender"];
const KIND_HINT: Record<EntryKind, string> = {
  opening: "The balance on a date, from the service book. One per leave; correct it later with an adjustment.",
  credit: "Days added to the balance, such as a yearly credit.",
  adjust: "Puts a wrong balance right, adding or taking away days.",
  surrender: "Earned leave surrendered for pay: the days come off the balance and a task with the surrender steps is made.",
};

function LineForm({ employee, types, balances, today, onDone }: { employee: Employee; types: LeaveType[]; balances: { typeId: string; balance: number }[]; today: string; onDone: () => void }) {
  const { addLine, surrender } = useLeaveActions();
  const [kind, setKind] = useState<EntryKind>("opening");
  const [doneSteps, setDoneSteps] = useState<string[]>([]);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [onDate, setOnDate] = useState(today);
  const [days, setDays] = useState("");
  const [takeAway, setTakeAway] = useState(false);
  const [note, setNote] = useState("");
  const n = Number(days);
  const value = days.trim() === "" || Number.isNaN(n) ? null : (kind === "adjust" && takeAway) || kind === "surrender" ? -n : n;
  const now = balances.find((b) => b.typeId === typeId)?.balance ?? 0;
  const type = types.find((t) => t.id === typeId);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (value == null) return;
    if (kind === "surrender") surrender.mutate({ employeeId: employee.id, input: { typeId, days: n, onDate, note, doneSteps } }, { onSuccess: onDone });
    else addLine.mutate({ employeeId: employee.id, input: { typeId, kind, onDate, days: value, note } }, { onSuccess: onDone });
  };
  const radio = "inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800";
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{employee.name}</p>
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Entry</span>
        {/* Its own buttons (type="button"), so choosing never submits the form. */}
        <div role="radiogroup" aria-label="Entry" className="flex flex-wrap gap-1.5">
          {ENTRY_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={radio}>
              {k === "surrender" ? "Surrender" : LEDGER_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-footnote text-slate-500">{KIND_HINT[kind]}</p>
      </div>
      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <Field label="Leave">
          <select className={inputClass} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.short && t.short !== t.name ? ` (${t.short})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={kind === "opening" ? "Balance as on" : "Date"}>
          <input type="date" required className={inputClass} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </Field>
      </div>
      {kind === "adjust" && (
        <div role="radiogroup" aria-label="Add or take away" className="flex flex-wrap gap-1.5">
          {([
            [false, "Add days"],
            [true, "Take away days"],
          ] as const).map(([away, text]) => (
            <button key={text} type="button" role="radio" aria-checked={takeAway === away} onClick={() => setTakeAway(away)} className={radio}>
              {text}
            </button>
          ))}
        </div>
      )}
      <Field label="Days">
        <input type="number" inputMode="decimal" required min={kind === "opening" ? -9999 : 0.5} max={9999} step={0.5} className={inputClass} value={days} onChange={(e) => setDays(e.target.value)} placeholder={kind === "opening" ? "e.g. 120" : "e.g. 20"} />
      </Field>
      <Field label="Note">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={kind === "opening" ? "e.g. From service book, page 14" : "e.g. Order No. A1/123/2026"} />
      </Field>
      {type && value != null && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-footnote text-slate-600">
          {leaveShort(type)} balance: {formatDays(now)} → <span className="font-medium text-ink">{formatDays(now + value)}</span>
          {type.maxBalance != null && now + value > type.maxBalance && kind === "credit" && ` (above ${daysWord(type.maxBalance)}: the extra lapses)`}
          {kind === "surrender" && now + value < 0 && " — more than the balance"}
        </p>
      )}
      {kind === "surrender" && (
        <fieldset className="rounded-lg border border-line px-3 py-2">
          <legend className="px-1 text-sm font-medium text-ink">Steps already done</legend>
          {SURRENDER_STEPS.map((s) => (
            <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5"
                checked={doneSteps.includes(s.id)}
                onChange={(e) => setDoneSteps((d) => (e.target.checked ? [...d, s.id] : d.filter((x) => x !== s.id)))}
              />
              <span className="text-sm text-ink">{s.text}</span>
            </label>
          ))}
        </fieldset>
      )}
      <ErrorNote error={addLine.error ?? surrender.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={addLine.isPending || value == null || !typeId}>
          <Check size={16} /> Save
        </Button>
      </div>
    </form>
  );
}
