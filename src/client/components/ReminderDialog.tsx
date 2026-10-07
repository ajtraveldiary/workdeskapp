// Add / edit a reminder (stored as a report): the fields of a standard add-reminder screen (user request
// 2026-10-06): title, date, optional time, repeat, end repeat, remind me, priority and notes. No labels.
import { useState, type FormEvent } from "react";
import type { Priority, ReminderLink, Report } from "../../shared/types";
import { REMIND_OPTIONS, REPEATS, REPEAT_LABEL, nextOccurrence, occurrences, remindLabel, repeatText, type Repeat } from "../../shared/reminderSchedule";
import { useCreateReport, useMe, useUpdateReport } from "../api";
import { formatDay, formatTime } from "../format";
import { LinksEditor } from "./ReminderLinks";
import { NO_RELATED, TitleWithRelated, type RelatedValue } from "./Related";
import { Button, ErrorNote, Field, Modal, inputClass } from "./ui";

export type ReminderDialogMode = { kind: "new" } | { kind: "edit"; report: Report };

export function ReminderDialog({ mode, onClose }: { mode: ReminderDialogMode | null; onClose: () => void }) {
  return (
    <Modal open={mode !== null} onClose={onClose} title={mode?.kind === "edit" ? "Edit reminder" : "New reminder"}>
      {mode && <ReminderForm key={mode.kind === "edit" ? mode.report.id : "new"} mode={mode} onDone={onClose} />}
    </Modal>
  );
}

function ReminderForm({ mode, onDone }: { mode: ReminderDialogMode; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const r = mode.kind === "edit" ? mode.report : null;

  const [name, setName] = useState(r?.name ?? "");
  // Editing shows the next date still to come; the date is only saved when changed, so the schedule stays put.
  const shownDate = r ? (nextOccurrence(r, today) ?? r.startDate) : today;
  const [startDate, setStartDate] = useState(shownDate);
  const [dueTime, setDueTime] = useState(r?.dueTime ?? "");
  const [repeat, setRepeat] = useState<Repeat>(r?.repeat ?? "never");
  const [endsOn, setEndsOn] = useState(!!r?.endDate);
  const [endDate, setEndDate] = useState(r?.endDate ?? "");
  const [leadDays, setLeadDays] = useState(r?.leadDays ?? 0);
  const [priority, setPriority] = useState<Priority>(r?.priority ?? "normal");
  const [notes, setNotes] = useState(r?.notes ?? "");
  const [links, setLinks] = useState<ReminderLink[]>(r?.links ?? []);
  // A link pasted but not yet added is saved too.
  const [draftLink, setDraftLink] = useState<ReminderLink | null>(null);
  // What it is about (Staff, user request 2026-10-07); its tasks carry it too.
  const [related, setRelated] = useState<RelatedValue>(r ? { relatedKind: r.relatedKind, relatedId: r.relatedId } : NO_RELATED);

  const repeats = repeat !== "never";
  const rule = { repeat, startDate: startDate || today, dueDay: Number((startDate || today).slice(8, 10)), endDate: repeats && endsOn && endDate ? endDate : null };
  const next = occurrences(rule, () => true, 3);

  const create = useCreateReport();
  const update = useUpdateReport();
  const pending = create.isPending || update.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { name, notes, repeat, startDate, dueTime: dueTime || null, endDate: rule.endDate, leadDays, priority, links: draftLink ? [...links, draftLink] : links, ...related };
    if (r) {
      const { startDate: _, ...rest } = input;
      await update.mutateAsync({ id: r.id, input: startDate === shownDate ? rest : input });
    } else await create.mutateAsync(input);
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <TitleWithRelated value={related} onChange={setRelated}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Submit HMIS report, Staff meeting, Pay electricity bill" required autoFocus={!r} />
        </TitleWithRelated>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
            Time
            {dueTime ? (
              <button type="button" onClick={() => setDueTime("")} className="text-footnote font-medium text-brand-700 hover:underline active:scale-[0.97]">
                Clear
              </button>
            ) : (
              <span className="text-footnote font-normal text-slate-400">Optional</span>
            )}
          </span>
          <input type="time" className={inputClass} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Repeat">
          <select className={inputClass} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {REPEATS.map((k) => (
              <option key={k} value={k}>
                {REPEAT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {repeats && (
          <Field label="End repeat">
            <select className={inputClass} value={endsOn ? "date" : "never"} onChange={(e) => setEndsOn(e.target.value === "date")}>
              <option value="never">Never</option>
              <option value="date">On a date</option>
            </select>
          </Field>
        )}
      </div>
      {repeats && endsOn && (
        <Field label="Last date">
          <input type="date" className={inputClass} value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Remind me">
          <select className={inputClass} value={leadDays} onChange={(e) => setLeadDays(Number(e.target.value))}>
            {REMIND_OPTIONS.some((o) => o.days === leadDays) || <option value={leadDays}>{remindLabel(leadDays)}</option>}
            {REMIND_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="normal">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          className="min-h-16 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </Field>

      <LinksEditor links={links} onChange={setLinks} onDraft={setDraftLink} />

      <div className="rounded-lg bg-tint px-3.5 py-2.5 text-footnote text-slate-600">
        <p className="font-medium text-ink">
          {repeatText(rule)}
          {dueTime && ` · ${formatTime(dueTime)}`}
        </p>
        {repeats && next.length > 1 && <p className="mt-0.5">Next: {next.map((d) => formatDay(d, today)).join(", ")}</p>}
        <p className="mt-0.5">
          {repeats ? "A task appears " : "The task appears "}
          {leadDays === 0 ? (repeats ? "on each date." : "on the date.") : `${remindLabel(leadDays)} ${repeats ? "each date" : "the date"}.`}
        </p>
      </div>

      <ErrorNote error={create.error ?? update.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {r ? "Save" : "Add reminder"}
        </Button>
      </div>
    </form>
  );
}
