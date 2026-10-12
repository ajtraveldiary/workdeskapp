// Add / edit an event: meeting, training, programme (user request 2026-10-11). Opened from anywhere with
// openEventForm(): the Events page, Calendar, an employee's page, or "Make event" on an email (then the title is the
// subject, a date written in the email is filled in, and the email leaves Pending; see routes/officeEvents.ts).
// Lives once in the app shell (EventDialogHost).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarRange, Check, ClipboardList, X } from "lucide-react";
import type { OfficeEvent, ReminderLink, Thread } from "../../shared/types";
import { EVENT_KINDS, EVENT_KIND_LABEL, PREP_OPTIONS, type EventKind } from "../../shared/eventSchedule";
import { REPEATS, REPEAT_LABEL, type Repeat } from "../../shared/reminderSchedule";
import { findDueDate } from "../../shared/findDates";
import type { EventInput } from "../../shared/schemas";
import { useEmailContent, useMe, useOfficeEventActions, useStaff } from "../api";
import { htmlToText } from "../snippets";
import { LinksEditor } from "./ReminderLinks";
import { TagPicker } from "./Tags";
import { Button, ErrorNote, Field, Modal, cx, inputClass } from "./ui";

export type EventFormMode = { kind: "new"; date?: string; attendeeId?: string } | { kind: "edit"; event: OfficeEvent } | { kind: "fromThread"; thread: Thread };

let opener: ((m: EventFormMode) => void) | null = null;
export const openEventForm = (m: EventFormMode) => opener?.(m);

export function EventDialogHost() {
  const [mode, setMode] = useState<EventFormMode | null>(null);
  useEffect(() => {
    opener = setMode;
    return () => {
      opener = null;
    };
  }, []);
  return (
    <Modal open={mode !== null} onClose={() => setMode(null)} title={mode?.kind === "edit" ? "Edit event" : "New event"}>
      {mode && <EventForm key={mode.kind === "edit" ? mode.event.id : mode.kind === "fromThread" ? mode.thread.id : "new"} mode={mode} onDone={() => setMode(null)} />}
    </Modal>
  );
}

function EventForm({ mode, onDone }: { mode: EventFormMode; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const e = mode.kind === "edit" ? mode.event : null;
  const thread = mode.kind === "fromThread" ? mode.thread : null;
  const employees = [...(useStaff().data?.employees ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const [title, setTitle] = useState(e?.title ?? thread?.subject ?? "");
  const [kind, setKind] = useState<EventKind>(e?.kind ?? "meeting");
  const [startDate, setStartDate] = useState<string>(e?.startDate ?? (mode.kind === "new" ? mode.date : undefined) ?? today);
  const [startTime, setStartTime] = useState(e?.startTime ?? "");
  const [endTime, setEndTime] = useState(e?.endTime ?? "");
  const [repeat, setRepeat] = useState<Repeat>(e?.repeat ?? "never");
  const [endDate, setEndDate] = useState(e?.endDate ?? "");
  const [venue, setVenue] = useState(e?.venue ?? "");
  const [meetingUrl, setMeetingUrl] = useState(e?.meetingUrl ?? "");
  const [organiser, setOrganiser] = useState(e?.organiser ?? (thread ? (thread.fromName ?? "") : ""));
  const [attendeeIds, setAttendeeIds] = useState<string[]>(e?.attendeeIds ?? (mode.kind === "new" && mode.attendeeId ? [mode.attendeeId] : []));
  const [notes, setNotes] = useState(e?.notes ?? "");
  const [links, setLinks] = useState<ReminderLink[]>(e?.links ?? []);
  const [draftLink, setDraftLink] = useState<ReminderLink | null>(null);
  const [tagIds, setTagIds] = useState<string[]>(e?.tagIds ?? []);
  const [prep, setPrep] = useState<number | null>(e ? e.prepDays : null);

  // From an email: a date written in its newest message becomes the event's date, until the user picks one.
  const email = useEmailContent(thread);
  const dateTouched = useRef(false);
  useEffect(() => {
    const newest = email.data?.messages.at(-1);
    if (!newest || dateTouched.current) return;
    const found = findDueDate(newest.html ? htmlToText(newest.html) : (newest.text ?? ""), today);
    if (found) setStartDate(found);
  }, [email.data, today]);

  const { add, save } = useOfficeEventActions();
  const busy = add.isPending || save.isPending;
  const repeats = repeat !== "never";
  const badTimes = !!endTime && (!startTime || endTime <= startTime);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (badTimes) return;
    const input: EventInput = {
      title,
      kind,
      startDate,
      startTime: startTime || null,
      endTime: (startTime && endTime) || null,
      repeat,
      endDate: repeats ? endDate || null : null,
      venue,
      meetingUrl: meetingUrl.trim(),
      organiser,
      attendeeIds,
      notes,
      links: draftLink ? [...links, draftLink] : links,
      tagIds,
      prepDays: prep,
    };
    try {
      if (e) await save.mutateAsync({ id: e.id, input });
      else await add.mutateAsync({ ...input, threadId: thread?.id ?? null });
      onDone();
    } catch {
      // shown under the form
    }
  };

  const others = employees.filter((x) => !attendeeIds.includes(x.id) && !x.leftOn);

  return (
    <form onSubmit={submit} className="space-y-4">
      {thread && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          From <span className="font-medium text-slate-800">{thread.fromName ?? thread.fromEmail}</span>. The email leaves Pending and is marked as an event
          {prep !== null ? " (it becomes the preparation task's email)" : ""}.
        </p>
      )}
      <Field label="Title">
        <input className={inputClass} value={title} onChange={(x) => setTitle(x.target.value)} required autoFocus={!e} maxLength={300} placeholder="e.g. Monthly review meeting, Fire safety training" />
      </Field>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Type</span>
        <div role="radiogroup" aria-label="Type" className="flex flex-wrap gap-1.5">
          {EVENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800"
            >
              {EVENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Date">
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={(x) => {
              dateTouched.current = true;
              setStartDate(x.target.value);
            }}
            required
          />
        </Field>
        <Field label="Starts (optional)">
          <input type="time" className={inputClass} value={startTime} onChange={(x) => setStartTime(x.target.value)} />
        </Field>
        <Field label="Ends (optional)">
          <input type="time" className={inputClass} value={endTime} onChange={(x) => setEndTime(x.target.value)} disabled={!startTime} />
        </Field>
      </div>
      {badTimes && <p className="-mt-2 text-footnote text-urgent-ink">The end time must be after the start time.</p>}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Repeat">
          <select className={inputClass} value={repeat} onChange={(x) => setRepeat(x.target.value as Repeat)}>
            {REPEATS.map((k) => (
              <option key={k} value={k}>
                {REPEAT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {repeats && (
          <Field label="Last date (optional)">
            <input type="date" className={inputClass} value={endDate} min={startDate} onChange={(x) => setEndDate(x.target.value)} />
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Venue">
          <input className={inputClass} value={venue} onChange={(x) => setVenue(x.target.value)} maxLength={300} placeholder="e.g. Conference hall" />
        </Field>
        <Field label="Meeting link (optional)">
          <input className={inputClass} value={meetingUrl} onChange={(x) => setMeetingUrl(x.target.value)} inputMode="url" maxLength={2000} placeholder="https://meet.google.com/…" />
        </Field>
      </div>
      <Field label="Organised by (optional)">
        <input className={inputClass} value={organiser} onChange={(x) => setOrganiser(x.target.value)} maxLength={200} placeholder="e.g. Head office, HR department" />
      </Field>

      {/* Who attends, from the Employees list. Not a <Field>: the chips have their own buttons. */}
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Who attends (optional)</span>
        {attendeeIds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attendeeIds.map((id) => {
              const p = employees.find((x) => x.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2.5 text-footnote text-slate-700">
                  {p?.name ?? "Employee"}
                  <button type="button" onClick={() => setAttendeeIds(attendeeIds.filter((x) => x !== id))} aria-label={`Remove ${p?.name ?? "employee"}`} className="rounded-full p-0.5 text-slate-500 hover:text-ink active:scale-90">
                    <X size={13} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <select className={inputClass} value="" onChange={(x) => x.target.value && setAttendeeIds([...attendeeIds, x.target.value])} aria-label="Add a person" disabled={!others.length}>
          <option value="">{employees.length ? "Add a person…" : "No employees yet (Employees page)"}</option>
          {others.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>

      <Field label="Notes / agenda (optional)">
        <textarea className={cx(inputClass, "h-auto py-2")} rows={3} value={notes} onChange={(x) => setNotes(x.target.value)} maxLength={10_000} />
      </Field>
      <LinksEditor links={links} onChange={setLinks} onDraft={setDraftLink} />
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Tags</span>
        <TagPicker value={tagIds} onChange={setTagIds} />
      </div>

      {/* Optional preparation task (user's choice 2026-10-11). */}
      <div className="rounded-lg border border-line p-3">
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={prep !== null} onChange={(x) => setPrep(x.target.checked ? 1 : null)} className="size-4 accent-brand-600" />
          <ClipboardList size={16} className="text-brand-700" /> Make a task to prepare
        </label>
        {prep !== null && (
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-6 text-sm text-slate-600">
            Due
            <select className={cx(inputClass, "w-auto!")} value={prep} onChange={(x) => setPrep(Number(x.target.value))} aria-label="When the preparation task is due">
              {PREP_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-footnote text-slate-500">{repeats ? "one for each date, from a month ahead" : ""}</span>
          </div>
        )}
      </div>

      <ErrorNote error={add.error ?? save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || badTimes}>
          {e ? <Check size={16} /> : <CalendarRange size={16} />} {e ? "Save" : "Add event"}
        </Button>
      </div>
    </form>
  );
}
