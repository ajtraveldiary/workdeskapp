// Mark leave / edit a leave (user request 2026-10-30, docs/LEAVE_PLAN.md phase 2). The days are the calendar days
// from–to (editable: holidays left out, half days); the form shows the balance before and after and warns, without
// stopping, when it would go below zero or past the type's limit in the whole service. A new leave makes its task
// with the gazetted or non-gazetted steps (ones already done can be ticked); editing records the rejoining date
// (an earlier one curtails the leave) and can cancel the leave (its days come back).
import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import type { EmployeeLeave, LeaveType, StaffList } from "../../shared/types";
import { calendarDays, daysWord, formatDays, leaveEnd, leaveShort, leaveSteps, postponeDays, shiftDate } from "../../shared/leave";
import { dayLabel } from "../../shared/reminderSchedule";
import { showUndo } from "./SwipeRow";
import { useLeaveAccount, useLeaveActions, useLeaveTypes, useMe, useStaff } from "../api";
import { Button, ErrorNote, Field, Modal, cx, inputClass } from "./ui";

export type LeaveFormState = { employeeId?: string; leave?: EmployeeLeave } | null;

export function LeaveDialog({ state, onClose }: { state: LeaveFormState; onClose: () => void }) {
  const staff = useStaff().data;
  const types = useLeaveTypes().data?.types;
  return (
    <Modal open={!!state} onClose={onClose} title={state?.leave ? "Leave" : "Mark leave"}>
      {state && staff && types && <LeaveForm state={state} staff={staff} types={types} onDone={onClose} />}
    </Modal>
  );
}

// Which balance a type takes from, and how many days of it for each day of leave.
const takesFrom = (t: LeaveType | undefined) => (!t ? null : t.hasAccount ? { typeId: t.id, perDay: 1 } : t.drawsOnId ? { typeId: t.drawsOnId, perDay: t.perDay } : null);

function LeaveForm({ state, staff, types, onDone }: { state: NonNullable<LeaveFormState>; staff: StaffList; types: LeaveType[]; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { markLeave, saveLeave, cancelLeave, undoPostpone } = useLeaveActions();
  const editing = state.leave ?? null;
  const [employeeId, setEmployeeId] = useState(editing?.employeeId ?? state.employeeId ?? "");
  const [typeId, setTypeId] = useState(editing?.typeId ?? types[0]?.id ?? "");
  const [fromDate, setFrom] = useState(editing?.fromDate ?? today);
  const [toDate, setTo] = useState(editing?.toDate ?? today);
  const [rejoinedOn, setRejoined] = useState(editing?.rejoinedOn ?? "");
  const [days, setDays] = useState(String(editing?.days ?? 1));
  // The days follow the dates until typed by hand.
  const [daysByHand, setDaysByHand] = useState(!!editing && editing.days !== calendarDays(editing.fromDate, leaveEnd(editing)));
  const [orderNo, setOrderNo] = useState(editing?.orderNo ?? "");
  const [orderDate, setOrderDate] = useState(editing?.orderDate ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [doneSteps, setDoneSteps] = useState<string[]>([]);
  // EOL (phase 4): move the next increment and the Probation declaration task by its days (ticked to start).
  const [moveIncrement, setMoveIncrement] = useState(true);
  const [moveProbation, setMoveProbation] = useState(true);
  const account = useLeaveAccount(employeeId).data;

  const employee = staff.employees.find((e) => e.id === employeeId);
  const type = types.find((t) => t.id === typeId);
  const end = rejoinedOn ? leaveEnd({ toDate, rejoinedOn }) : toDate;
  const setDates = (from: string, to: string, rejoined: string) => {
    setFrom(from);
    setTo(to);
    setRejoined(rejoined);
    const last = rejoined ? leaveEnd({ toDate: to, rejoinedOn: rejoined }) : to;
    if (!daysByHand && from && last >= from) setDays(String(calendarDays(from, last)));
  };
  const n = Number(days);
  const okDays = days.trim() !== "" && n >= 0.5 && Number.isInteger(n * 2);

  // Balance before and after (an edited leave's own days are already taken, so they are added back first).
  const from = takesFrom(type);
  const source = from && types.find((t) => t.id === from.typeId);
  const was = editing && takesFrom(types.find((t) => t.id === editing.typeId));
  const now = (from && account?.balances.find((b) => b.typeId === from.typeId)?.balance) ?? 0;
  const back = was && from && was.typeId === from.typeId ? editing!.days * was.perDay : 0;
  const after = from && okDays ? now + back - n * from.perDay : null;
  const short = after != null && after < 0 && !type?.mayGoNegative;
  const used = (type && account?.used.find((u) => u.typeId === type.id)?.days) ?? 0;
  const usedAfter = used - (editing && editing.typeId === typeId ? editing.days : 0) + (okDays ? n : 0);
  const pastLimit = type?.serviceLimit != null && usedAfter > type.serviceLimit;

  // A leave that doesn't count for increment or probation (EOL): offer to move those dates.
  const moveBy = okDays ? postponeDays(n) : 0;
  const offerIncrement = !editing && !!type?.delaysIncrement && !!employee?.nextIncrementOn;
  const offerProbation = !editing && !!type?.delaysIncrement && !!employee && !employee.probationDeclared && !employee.probationDeclaredOn;

  // Permanent staff in the office (and the one being edited), by designation in its order.
  const people = staff.employees.filter((e) => e.permanent && (!e.leftOn || e.id === employeeId));
  const groups = [
    ...staff.designations.map((d) => ({ label: d.name, list: people.filter((e) => e.designationId === d.id) })),
    { label: "No designation", list: people.filter((e) => !e.designationId || !staff.designations.some((d) => d.id === e.designationId)) },
  ].filter((g) => g.list.length);

  const save = editing ? saveLeave : markLeave;
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!okDays || !employeeId || !typeId) return;
    const fields = { typeId, fromDate, toDate, days: n, orderNo, orderDate: orderDate || null, notes };
    try {
      if (editing) await saveLeave.mutateAsync({ id: editing.id, input: { ...fields, rejoinedOn: rejoinedOn || null } });
      else {
        const postpone = { increment: offerIncrement && moveIncrement, probation: offerProbation && moveProbation };
        const r = await markLeave.mutateAsync({ ...fields, employeeId, doneSteps, postpone });
        const moved = [r.postponed.increment && `next increment to ${dayLabel(r.postponed.increment.to)}`, r.postponed.probation && `probation task to ${dayLabel(r.postponed.probation.to)}`].filter(Boolean);
        if (moved.length) showUndo({ message: `Leave marked; ${moved.join(", ")}`, onUndo: () => undoPostpone.mutate({ id: r.id, ...r.postponed }) });
      }
      onDone();
    } catch {
      // shown under the form
    }
  };
  const cancel = () => {
    if (!editing || !confirm(`Cancel this leave? Its days go back to the balance, and its task is completed.`)) return;
    cancelLeave.mutate(editing.id, { onSuccess: onDone });
  };
  const cancelled = editing?.status === "cancelled";

  return (
    <form onSubmit={submit} className="space-y-4">
      {editing ? (
        <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{employee?.name}</p>
      ) : (
        <Field label="Employee">
          <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required disabled={!!state.employeeId}>
            <option value="">Choose…</option>
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
        </Field>
      )}
      {cancelled && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">This leave was cancelled; its days went back to the balance.</p>}
      <Field label="Leave">
        <select className={inputClass} value={typeId} onChange={(e) => setTypeId(e.target.value)} required disabled={cancelled}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.short && t.short !== t.name ? ` (${t.short})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 min-[400px]:grid-cols-3">
        <Field label="From">
          <input type="date" required className={inputClass} value={fromDate} disabled={cancelled} onChange={(e) => setDates(e.target.value, toDate < e.target.value ? e.target.value : toDate, rejoinedOn)} />
        </Field>
        <Field label="To">
          <input type="date" required min={fromDate} className={inputClass} value={toDate} disabled={cancelled} onChange={(e) => setDates(fromDate, e.target.value, rejoinedOn)} />
        </Field>
        <Field label="Days">
          <input
            type="number"
            inputMode="decimal"
            required
            min={0.5}
            step={0.5}
            className={inputClass}
            value={days}
            disabled={cancelled}
            onChange={(e) => {
              setDays(e.target.value);
              setDaysByHand(true);
            }}
          />
        </Field>
      </div>
      {fromDate && end >= fromDate && (
        <p className="-mt-2 text-footnote text-slate-500">
          {daysWord(calendarDays(fromDate, end))} from {fromDate === end ? "that day" : "the first day to the last"}; change Days to leave out holidays.
          {!rejoinedOn && ` Due back on ${shiftDate(toDate, 1).split("-").reverse().join("/")}.`}
        </p>
      )}
      {editing && !cancelled && (
        <Field label="Rejoined on (joining report)">
          <input type="date" min={shiftDate(fromDate, 1)} className={inputClass} value={rejoinedOn} onChange={(e) => setDates(fromDate, toDate, e.target.value)} />
        </Field>
      )}
      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <Field label="Order number">
          <input className={inputClass} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} maxLength={100} disabled={cancelled} placeholder="e.g. A1/1234/2026" />
        </Field>
        <Field label="Order date">
          <input type="date" className={inputClass} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} disabled={cancelled} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={cx(inputClass, "h-auto py-2")} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} disabled={cancelled} />
      </Field>
      {!cancelled && employee && (
        <div className={cx("space-y-1 rounded-lg px-3 py-2 text-footnote", short || pastLimit ? "bg-urgent-soft text-urgent-ink" : "bg-slate-50 text-slate-600")}>
          {source && after != null ? (
            <p>
              {leaveShort(source)} balance: {formatDays(now)} → <span className="font-semibold">{formatDays(after)}</span>
              {from!.perDay !== 1 && ` (${formatDays(from!.perDay)} days of ${leaveShort(source)} for each day)`}
              {short && ". Not enough balance; it can still be saved if the leave is sanctioned."}
            </p>
          ) : (
            type && <p>{type.name} doesn't take from a leave balance.</p>
          )}
          {type?.serviceLimit != null && (
            <p>
              {leaveShort(type)} in the whole service: {formatDays(usedAfter)} of {formatDays(type.serviceLimit)} days{pastLimit && " — past the limit"}.
            </p>
          )}
        </div>
      )}
      {(offerIncrement || offerProbation) && moveBy > 0 && (
        <fieldset className="rounded-lg border border-line px-3 py-2">
          <legend className="px-1 text-sm font-medium text-ink">{type!.name} doesn't count for increment or probation</legend>
          {offerIncrement && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
              <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={moveIncrement} onChange={(e) => setMoveIncrement(e.target.checked)} />
              <span className="text-sm text-ink">
                Move the next increment by {daysWord(moveBy)}: {dayLabel(employee!.nextIncrementOn!)} → {dayLabel(shiftDate(employee!.nextIncrementOn!, moveBy))}
              </span>
            </label>
          )}
          {offerProbation && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
              <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={moveProbation} onChange={(e) => setMoveProbation(e.target.checked)} />
              <span className="text-sm text-ink">Move the Probation declaration task's due date by {daysWord(moveBy)} (when there is one)</span>
            </label>
          )}
        </fieldset>
      )}
      {!editing && employee && (
        <fieldset className="rounded-lg border border-line px-3 py-2">
          <legend className="px-1 text-sm font-medium text-ink">Steps already done ({employee.gazetted ? "gazetted" : "non-gazetted"})</legend>
          {leaveSteps(employee.gazetted).map((s) => (
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
          <p className="px-1.5 pb-1 text-footnote text-slate-500">A task with these steps is made, due on the day they are back.</p>
        </fieldset>
      )}
      <ErrorNote error={save.error ?? cancelLeave.error} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && !cancelled && (
          <Button type="button" variant="danger" onClick={cancel} disabled={cancelLeave.isPending} className="mr-auto">
            <X size={15} /> Cancel leave
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onDone}>
          Close
        </Button>
        {!cancelled && (
          <Button type="submit" variant="primary" disabled={save.isPending || !okDays || !employeeId || !typeId}>
            <Check size={16} /> {editing ? "Save" : "Mark leave"}
          </Button>
        )}
      </div>
    </form>
  );
}
