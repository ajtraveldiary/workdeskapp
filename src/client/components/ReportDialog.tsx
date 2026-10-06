import { useState, type FormEvent } from "react";
import type { Frequency, Priority, Report } from "../../shared/types";
import { FREQUENCY_LABEL, defaultFirstPeriod, periodsFrom, ruleText, type ScheduleRule } from "../../shared/reportSchedule";
import { useCreateReport, useMe, useUpdateReport } from "../api";
import { LabelField } from "./LabelChips";
import { addDays, formatDay } from "../format";
import { Button, ErrorNote, Field, Modal, inputClass } from "./ui";

export type ReportDialogMode = { kind: "new" } | { kind: "edit"; report: Report };

export function ReportDialog({ mode, onClose }: { mode: ReportDialogMode | null; onClose: () => void }) {
  return (
    <Modal open={mode !== null} onClose={onClose} title={mode?.kind === "edit" ? "Edit report" : "New recurring report"}>
      {mode && <ReportForm key={mode.kind === "edit" ? mode.report.id : "new"} mode={mode} onDone={onClose} />}
    </Modal>
  );
}

function ReportForm({ mode, onDone }: { mode: ReportDialogMode; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const r = mode.kind === "edit" ? mode.report : null;

  const [name, setName] = useState(r?.name ?? "");
  const [frequency, setFrequency] = useState<Frequency>(r?.frequency ?? "monthly");
  const [dueDay, setDueDay] = useState(r?.dueDay ?? 5);
  const [dueMonthOffset, setDueMonthOffset] = useState(r?.dueMonthOffset ?? 1);
  const [yearStartMonth, setYearStartMonth] = useState(r?.yearStartMonth ?? 4);
  const [leadDays, setLeadDays] = useState(r?.leadDays ?? 7);
  const [priority, setPriority] = useState<Priority>(r?.priority ?? "high");
  const [labelIds, setLabelIds] = useState<string[]>(r?.labelIds ?? []);
  const [responsible, setResponsible] = useState(r?.responsible ?? "");
  const [notes, setNotes] = useState(r?.notes ?? "");
  // Until the user picks one, the first period follows the rule: the earliest period not yet due.
  const [firstMonth, setFirstMonth] = useState<string | null>(r ? r.firstPeriodStart.slice(0, 7) : null);

  const rule: ScheduleRule = { frequency, dueDay: dueDay || 1, dueMonthOffset, yearStartMonth };
  const firstPeriodStart = firstMonth ? `${firstMonth}-01` : defaultFirstPeriod(rule, today);
  const preview = periodsFrom(rule, firstPeriodStart, () => true, 3);

  const create = useCreateReport();
  const update = useUpdateReport();
  const pending = create.isPending || update.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = {
      name,
      notes,
      frequency,
      dueDay,
      dueMonthOffset,
      yearStartMonth,
      leadDays,
      priority,
      labelIds,
      responsible: responsible.trim() || null,
      firstPeriodStart,
    };
    if (r) await update.mutateAsync({ id: r.id, input });
    else await create.mutateAsync(input);
    onDone();
  };

  const monthly = frequency === "monthly";

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Report name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly expenditure statement" required autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Frequency">
          <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABEL[f]}
              </option>
            ))}
          </select>
        </Field>
        {monthly ? (
          <Field label="Priority">
            <PrioritySelect value={priority} onChange={setPriority} />
          </Field>
        ) : (
          <Field label="Year starts in">
            <select className={inputClass} value={yearStartMonth} onChange={(e) => setYearStartMonth(Number(e.target.value))}>
              <option value={4}>April (financial year)</option>
              <option value={1}>January (calendar year)</option>
            </select>
          </Field>
        )}
      </div>

      <div className="grid grid-cols-[6rem_1fr] gap-4">
        <Field label="Due day">
          <input
            type="number"
            min={1}
            max={31}
            className={inputClass}
            value={dueDay}
            onChange={(e) => setDueDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
            required
          />
        </Field>
        <Field label="Of">
          <select className={inputClass} value={dueMonthOffset} onChange={(e) => setDueMonthOffset(Number(e.target.value))}>
            <option value={0}>{monthly ? "the same month" : "the period's last month"}</option>
            <option value={1}>{monthly ? "the following month" : "the month after the period ends"}</option>
            <option value={2}>the 2nd month after the period ends</option>
            <option value={3}>the 3rd month after the period ends</option>
          </select>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-slate-500">Use 31 for the last day of the month.</p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Create the task">
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={90} className={`${inputClass} w-16 shrink-0`} value={leadDays} onChange={(e) => setLeadDays(Math.min(90, Math.max(0, Number(e.target.value) || 0)))} />
            <span className="text-sm whitespace-nowrap text-slate-600">days before due</span>
          </div>
        </Field>
        <Field label="First period to track">
          <input type="month" className={inputClass} value={firstPeriodStart.slice(0, 7)} onChange={(e) => setFirstMonth(e.target.value || null)} required />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {!monthly && (
          <Field label="Priority">
            <PrioritySelect value={priority} onChange={setPriority} />
          </Field>
        )}
        <Field label="Responsible (optional)">
          <input className={inputClass} value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Person or section" />
        </Field>
      </div>
      <Field label="Labels (given to each period's task)">
        <LabelField value={labelIds} onChange={setLabelIds} />
      </Field>

      <Field label="Notes (copied into each task)">
        <textarea className="min-h-16 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-200" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="rounded-lg bg-tint px-3.5 py-3 text-sm">
        <p className="font-medium text-ink">{ruleText(rule)}</p>
        <ul className="mt-2 space-y-1 text-slate-600">
          {preview.map((p) => (
            <li key={p.periodStart} className="flex flex-wrap justify-between gap-x-3">
              <span>{p.label}</span>
              <span>
                due <span className="font-medium text-ink">{formatDay(p.dueDate, today)}</span>
                <span className="text-slate-400"> · task from {formatDay(addDays(p.dueDate, -leadDays), today)}</span>
              </span>
            </li>
          ))}
        </ul>
        {r && <p className="mt-2 text-xs text-slate-500">Changes apply to periods created from now on; existing periods keep their due dates.</p>}
      </div>

      <ErrorNote error={create.error ?? update.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {r ? "Save" : "Create report"}
        </Button>
      </div>
    </form>
  );
}

function PrioritySelect({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Priority)}>
      <option value="urgent">Urgent</option>
      <option value="high">High</option>
      <option value="normal">Medium</option>
      <option value="low">Low</option>
    </select>
  );
}
