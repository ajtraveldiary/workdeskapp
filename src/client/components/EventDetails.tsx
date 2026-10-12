// One date of an event (user request 2026-10-11): when and where, who attends, notes, links and tags, with
// Mark done, Cancel this one, Move (postpone or bring forward), Edit and Delete. Opened from anywhere with
// openEventDetails({ id, date }) where date is the occurrence's scheduled day; lives once in the app shell.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Ban, CalendarDays, CalendarRange, Check, ClipboardList, Clock, MapPin, Pencil, Repeat as RepeatIcon, RotateCcw, StickyNote, Trash2, UserRound, UsersRound, Video } from "lucide-react";
import { PREP_OPTIONS, eventTypeLabel, eventOccurrences, shiftDay, timeRange } from "../../shared/eventSchedule";
import { repeatText } from "../../shared/reminderSchedule";
import { useMe, useOfficeEventActions, useOfficeEvents, useStaff } from "../api";
import { formatDay, formatTime } from "../format";
import { openEventForm } from "./EventDialog";
import { LinkChips } from "./ReminderLinks";
import { showUndo } from "./SwipeRow";
import { Badge, Button, ErrorNote, Field, Modal, TONE, cx, inputClass } from "./ui";

export type EventRef = { id: string; date: string };

let opener: ((r: EventRef) => void) | null = null;
export const openEventDetails = (r: EventRef) => opener?.(r);

export function EventDetailsHost() {
  const [ref, setRef] = useState<EventRef | null>(null);
  useEffect(() => {
    opener = setRef;
    return () => {
      opener = null;
    };
  }, []);
  return (
    <Modal open={ref !== null} onClose={() => setRef(null)} title="Event">
      {ref && <Details key={`${ref.id}:${ref.date}`} eventRef={ref} onClose={() => setRef(null)} />}
    </Modal>
  );
}

function Details({ eventRef, onClose }: { eventRef: EventRef; onClose: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { data } = useOfficeEvents();
  const staff = useStaff().data;
  const { occurrence, remove } = useOfficeEventActions();
  const [moving, setMoving] = useState(false);
  const e = data?.events.find((x) => x.id === eventRef.id);
  if (!data) return <p className="py-6 text-center text-sm text-slate-500">Loading…</p>;
  if (!e) return <p className="py-6 text-center text-sm text-slate-500">This event was deleted.</p>;
  // The occurrence: found by its scheduled day, wherever it was moved to.
  const rule = { ...e, changes: e.changes };
  const o =
    eventOccurrences(rule, shiftDay(eventRef.date, -400), shiftDay(eventRef.date, 400)).find((x) => x.original === eventRef.date) ??
    ({ date: eventRef.date, original: eventRef.date, startTime: e.startTime, endTime: e.endTime, status: "scheduled", moved: false } as const);
  const set = (status: "scheduled" | "done" | "cancelled", undoTo?: "scheduled" | "done" | "cancelled") =>
    occurrence.mutate(
      { id: e.id, date: o.original, status },
      { onSuccess: () => undoTo && showUndo({ message: status === "done" ? "Event marked done" : "Event cancelled", onUndo: () => occurrence.mutate({ id: e.id, date: o.original, status: undoTo }) }) },
    );
  const del = () => {
    const series = e.repeat !== "never";
    if (!confirm(series ? `Delete "${e.title}" and all its dates? Open preparation tasks go too.` : `Delete "${e.title}"? An open preparation task goes too.`)) return;
    remove.mutate(e.id, { onSuccess: onClose });
  };
  const people = e.attendeeIds.map((id) => staff?.employees.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  const mapsUrl = e.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.venue)}` : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className={o.status === "cancelled" ? "text-lg font-semibold text-slate-400 line-through" : "text-lg font-semibold text-ink"}>{e.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={cx("max-w-full rounded-md px-1.5 py-0.5 text-xs font-medium [overflow-wrap:anywhere]", TONE.info.soft)}>{eventTypeLabel(e.typeName)}</span>
          {o.status === "done" && <Badge tone="low">Done</Badge>}
          {o.status === "cancelled" && <Badge tone="urgent">Cancelled</Badge>}
          {o.moved && <Badge tone="high">Moved from {formatDay(o.original, today)}</Badge>}
        </div>
      </div>

      {(e.meetingUrl || mapsUrl) && o.status !== "cancelled" && (
        <div className="flex flex-wrap gap-2">
          {e.meetingUrl && (
            <a href={e.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 active:scale-[0.97]">
              <Video size={16} /> Join meeting
            </a>
          )}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.97]">
              <MapPin size={16} /> Directions
            </a>
          )}
        </div>
      )}

      <dl className="space-y-2.5 text-sm">
        <Row icon={CalendarDays} label="Date">
          {formatDay(o.date, today)}
        </Row>
        <Row icon={Clock} label="Time">
          {timeRange(o.startTime, o.endTime, formatTime)}
        </Row>
        {e.repeat !== "never" && (
          <Row icon={RepeatIcon} label="Repeats">
            {repeatText(e)}
          </Row>
        )}
        {e.venue && (
          <Row icon={MapPin} label="Venue">
            {e.venue}
          </Row>
        )}
        {e.organiser && (
          <Row icon={UserRound} label="Organised by">
            {e.organiser}
          </Row>
        )}
        {people.length > 0 && (
          <Row icon={UsersRound} label="Who attends">
            <span className="flex flex-wrap gap-x-2 gap-y-1">
              {people.map((p, i) => (
                <Link key={p.id} to={`/employees/${p.id}`} onClick={onClose} className="text-brand-700 hover:underline">
                  {p.name}
                  {i < people.length - 1 ? "," : ""}
                </Link>
              ))}
            </span>
          </Row>
        )}
        {e.prepDays !== null && (
          <Row icon={ClipboardList} label="Preparation">
            A task, due {(PREP_OPTIONS.find((p) => p.days === e.prepDays)?.label ?? `${e.prepDays} days before`).toLowerCase()}
          </Row>
        )}
        <Row icon={StickyNote} label="Notes">
          {e.notes ? <span className="select-text whitespace-pre-wrap">{e.notes}</span> : <span className="text-slate-500">No notes</span>}
        </Row>
      </dl>
      <LinkChips links={e.links} />

      {moving ? (
        <MoveForm
          initial={o}
          busy={occurrence.isPending}
          onCancel={() => setMoving(false)}
          onSave={(newDate, newTime, newEndTime) =>
            occurrence.mutate({ id: e.id, date: o.original, status: "moved", newDate, newTime, newEndTime }, { onSuccess: () => setMoving(false) })
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {o.status === "scheduled" ? (
            <>
              <Button size="sm" variant="primary" onClick={() => set("done", "scheduled")} disabled={occurrence.isPending}>
                <Check size={15} /> Mark done
              </Button>
              <Button size="sm" onClick={() => setMoving(true)}>
                <CalendarRange size={15} /> Move
              </Button>
              <Button size="sm" onClick={() => set("cancelled", "scheduled")} disabled={occurrence.isPending}>
                <Ban size={15} /> Cancel {e.repeat !== "never" ? "this date" : "it"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => set("scheduled")} disabled={occurrence.isPending}>
              <RotateCcw size={15} /> {o.status === "done" ? "Not done" : "Restore"}
            </Button>
          )}
          {o.moved && o.status === "scheduled" && (
            <Button size="sm" variant="ghost" onClick={() => occurrence.mutate({ id: e.id, date: o.original, status: "original" })} disabled={occurrence.isPending}>
              Back to {formatDay(o.original, today)}
            </Button>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => (onClose(), openEventForm({ kind: "edit", event: e }))}>
            <Pencil size={15} /> Edit
          </Button>
          <Button size="sm" variant="danger" onClick={del} disabled={remove.isPending} aria-label="Delete event" title="Delete event">
            <Trash2 size={15} />
          </Button>
        </div>
      )}
      <ErrorNote error={occurrence.error ?? remove.error} />
    </div>
  );
}

function MoveForm({ initial, busy, onCancel, onSave }: { initial: { date: string; startTime: string | null; endTime: string | null }; busy: boolean; onCancel: () => void; onSave: (d: string, t: string | null, e: string | null) => void }) {
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.startTime ?? "");
  const [end, setEnd] = useState(initial.endTime ?? "");
  const bad = !!end && (!start || end <= start);
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-ink">Move this date to</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Date">
          <input type="date" className={inputClass} value={date} onChange={(x) => setDate(x.target.value)} required />
        </Field>
        <Field label="Starts">
          <input type="time" className={inputClass} value={start} onChange={(x) => setStart(x.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="time" className={inputClass} value={end} onChange={(x) => setEnd(x.target.value)} disabled={!start} />
        </Field>
      </div>
      {bad && <p className="text-footnote text-urgent-ink">The end time must be after the start time.</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!date || bad || busy} onClick={() => onSave(date, start || null, (start && end) || null)}>
          Move
        </Button>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof CalendarDays; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="flex w-28 shrink-0 items-center gap-1.5 leading-5 whitespace-nowrap text-slate-500">
        <Icon size={15} className="shrink-0" /> {label}
      </dt>
      <dd className="min-w-0 flex-1 leading-5 text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
