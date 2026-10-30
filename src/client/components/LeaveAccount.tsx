// An employee's leave account (user request 2026-10-30, docs/LEAVE_PLAN.md), on their page: the balance of each
// leave that keeps one (EL, HPL…) and every line of the account, newest first, like the leave account in a service
// book. Lines are only added (opening balance from the service book, a credit, an adjustment), never changed:
// a wrong line is put right with an adjustment.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CalendarOff, Check, Plus } from "lucide-react";
import type { Employee, LeaveLine, LeaveType } from "../../shared/types";
import { HAND_KINDS, LEDGER_LABEL, daysWord, formatDays, leaveShort, type HandKind } from "../../shared/leave";
import { useLeaveAccount, useLeaveActions, useLeaveTypes } from "../api";
import { Button, Card, ErrorNote, Field, Modal, SkeletonList, cx, inputClass } from "./ui";

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
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center border-b border-line pr-2">
        <h2 className="flex flex-1 items-center gap-2 px-4 py-2.5 text-footnote font-semibold text-slate-600 sm:px-5">
          <CalendarOff size={15} className="text-brand-700" />
          Leave account
        </h2>
        {withAccount.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add
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
          </ul>
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
      <Modal open={adding} onClose={() => setAdding(false)} title="Leave account entry">
        {adding && <LineForm employee={employee} types={withAccount} balances={account.data?.balances ?? []} today={today} onDone={() => setAdding(false)} />}
      </Modal>
    </Card>
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

const KIND_HINT: Record<HandKind, string> = {
  opening: "The balance on a date, from the service book. One per leave; correct it later with an adjustment.",
  credit: "Days added to the balance, such as a yearly credit.",
  adjust: "Puts a wrong balance right, adding or taking away days.",
};

function LineForm({ employee, types, balances, today, onDone }: { employee: Employee; types: LeaveType[]; balances: { typeId: string; balance: number }[]; today: string; onDone: () => void }) {
  const { addLine } = useLeaveActions();
  const [kind, setKind] = useState<HandKind>("opening");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [onDate, setOnDate] = useState(today);
  const [days, setDays] = useState("");
  const [takeAway, setTakeAway] = useState(false);
  const [note, setNote] = useState("");
  const n = Number(days);
  const value = days.trim() === "" || Number.isNaN(n) ? null : kind === "adjust" && takeAway ? -n : n;
  const now = balances.find((b) => b.typeId === typeId)?.balance ?? 0;
  const type = types.find((t) => t.id === typeId);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (value == null) return;
    addLine.mutate({ employeeId: employee.id, input: { typeId, kind, onDate, days: value, note } }, { onSuccess: onDone });
  };
  const radio = "inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800";
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{employee.name}</p>
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Entry</span>
        {/* Its own buttons (type="button"), so choosing never submits the form. */}
        <div role="radiogroup" aria-label="Entry" className="flex flex-wrap gap-1.5">
          {HAND_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={radio}>
              {LEDGER_LABEL[k]}
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
        </p>
      )}
      <ErrorNote error={addLine.error} />
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
