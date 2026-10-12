// Events page (user request 2026-10-11): meetings, trainings, programmes, by day. Upcoming (the next 6 months),
// Today and Past (the last 6 months), with search and a tag filter. Tapping one opens its details (Mark done, Move,
// Cancel, Edit, Delete); phones swipe right for Done and left for Cancel / Edit. In the side rail after Calendar and
// in the phone profile panel.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Ban, CalendarRange, Check, MapPin, Pencil, Plus, UsersRound, Video } from "lucide-react";
import type { OfficeEvent } from "../../shared/types";
import { EVENT_KIND_LABEL, eventOccurrences, shiftDay, type EventOccurrence } from "../../shared/eventSchedule";
import { useOfficeEventActions, useOfficeEvents } from "../api";
import { formatDay, formatTime } from "../format";
import { openEventForm } from "../components/EventDialog";
import { openEventDetails } from "../components/EventDetails";
import { RefreshButton } from "../components/RefreshButton";
import { SwipeRow, showUndo, useSwipeMode } from "../components/SwipeRow";
import { TagChips, TagFilter } from "../components/Tags";
import { Badge, Button, Card, Fab, Menu, PageHeader, SearchInput, Segmented, SkeletonList, cx } from "../components/ui";

type View = "upcoming" | "today" | "past";
const WINDOW = 183;
type Item = { e: OfficeEvent; o: EventOccurrence };

export function EventsPage() {
  const { data, error } = useOfficeEvents();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View) ?? "upcoming";
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const today = data?.today ?? new Date().toISOString().slice(0, 10);

  const all = useMemo(() => {
    const list: Item[] = [];
    for (const e of data?.events ?? []) for (const o of eventOccurrences(e, shiftDay(today, -WINDOW), shiftDay(today, WINDOW))) list.push({ e, o });
    return list.sort((a, b) => a.o.date.localeCompare(b.o.date) || (a.o.startTime ?? "").localeCompare(b.o.startTime ?? ""));
  }, [data, today]);
  const query = q.trim().toLowerCase();
  const matches = (x: Item) =>
    (!tag || x.e.tagIds.includes(tag)) && (!query || [x.e.title, x.e.venue, x.e.organiser, x.e.notes].some((s) => s.toLowerCase().includes(query)));
  const upcoming = all.filter((x) => x.o.date >= today);
  const todays = all.filter((x) => x.o.date === today);
  const past = all.filter((x) => x.o.date < today).reverse();
  const shown = (view === "today" ? todays : view === "past" ? past : upcoming).filter(matches);
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const x of shown) m.set(x.o.date, [...(m.get(x.o.date) ?? []), x]);
    return [...m.entries()];
  }, [shown]);
  const add = () => openEventForm({ kind: "new", date: view === "today" ? today : undefined });

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Meetings, trainings and programmes. Make one from an email with Make event, or add it here."
        actions={
          <>
            <RefreshButton keys={[["office-events"]]} label="Refresh events" />
            <Button variant="primary" onClick={add} className="max-sm:hidden">
              <Plus size={17} /> New event
            </Button>
          </>
        }
      />
      <Fab label="New event" onClick={add} />
      {error ? (
        <p className="text-urgent-ink">{error.message}</p>
      ) : !data ? (
        <SkeletonList rows={6} />
      ) : data.events.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-info text-white">
            <CalendarRange size={22} />
          </span>
          <p className="mt-3 font-medium text-ink">No events yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">Add meetings, trainings and programmes: when and where, who attends, and a task to prepare if you need one.</p>
          <Button variant="primary" className="mt-4" onClick={add}>
            <Plus size={16} /> New event
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <Segmented<View>
            value={view}
            onChange={(v) => setParams(v === "upcoming" ? {} : { view: v }, { replace: true })}
            oneRow
            options={[
              { value: "upcoming", label: "Upcoming", count: upcoming.filter((x) => x.o.status === "scheduled").length },
              { value: "today", label: "Today", count: todays.filter((x) => x.o.status !== "cancelled").length, tone: todays.length ? "high" : undefined },
              { value: "past", label: "Past" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search events…" />
            <TagFilter value={tag} onChange={setTag} />
          </div>
          {groups.length === 0 ? (
            <Card>
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                {query || tag ? "No event matches." : view === "today" ? "No events today." : view === "past" ? "No events in the last 6 months." : "Nothing in the next 6 months."}
              </p>
            </Card>
          ) : (
            groups.map(([day, items]) => (
              <Card key={day} className="overflow-hidden">
                <h2 className={cx("border-b border-line px-4 py-2 text-footnote font-semibold sm:px-5", day === today ? "bg-tint text-brand-800" : "bg-slate-50/60 text-slate-600")}>
                  {formatDay(day, today)}
                  {day === today || day === shiftDay(today, 1) ? "" : ` · ${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" })}`}
                </h2>
                <ul className="divide-y divide-line">
                  {items.map((x) => (
                    <EventRow key={`${x.e.id}:${x.o.original}`} item={x} />
                  ))}
                </ul>
              </Card>
            ))
          )}
        </div>
      )}
    </>
  );
}

function EventRow({ item: { e, o } }: { item: Item }) {
  const swipe = useSwipeMode();
  const { occurrence } = useOfficeEventActions();
  const open = () => openEventDetails({ id: e.id, date: o.original });
  const set = (status: "done" | "cancelled") =>
    occurrence.mutateAsync({ id: e.id, date: o.original, status }).then(() =>
      showUndo({ message: status === "done" ? "Event marked done" : "Event cancelled", onUndo: () => occurrence.mutate({ id: e.id, date: o.original, status: "scheduled" }) }),
    );
  const cancelled = o.status === "cancelled";
  const scheduled = o.status === "scheduled";

  return (
    <SwipeRow
      contentClassName="row-click flex items-start gap-3 px-4 py-2.5 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5"
      leading={scheduled ? { label: "Done", icon: Check, tone: "low", onClick: () => set("done") } : null}
      trailing={[
        { label: "Cancel", icon: Ban, tone: "urgent", onClick: () => set("cancelled"), hidden: !scheduled },
        { label: "Edit", icon: Pencil, tone: "neutral", onClick: () => openEventForm({ kind: "edit", event: e }) },
      ]}
    >
      <span className={cx("w-[4.75rem] shrink-0 pt-px text-footnote tabular-nums sm:w-24", cancelled ? "text-slate-400 line-through" : "font-medium text-ink")}>
        {o.startTime ? formatTime(o.startTime) : "All day"}
        {o.endTime && <span className="block font-normal text-slate-500">{formatTime(o.endTime)}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <button onClick={open} className="row-link group/title block w-full text-left" aria-label={`Open event ${e.title}`}>
          <span className={cx("line-clamp-2 text-subhead leading-snug font-medium", cancelled ? "text-slate-400 line-through" : "text-ink group-hover/title:text-brand-700")}>{e.title}</span>
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-slate-500">
          <Badge tone="info">{EVENT_KIND_LABEL[e.kind]}</Badge>
          {o.status === "done" && <Badge tone="low">Done</Badge>}
          {cancelled && <Badge tone="urgent">Cancelled</Badge>}
          {o.moved && <Badge tone="high">Moved</Badge>}
          {e.venue && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin size={12} className="shrink-0" />
              <span className="truncate">{e.venue}</span>
            </span>
          )}
          {e.meetingUrl && (
            <span className="inline-flex items-center gap-1">
              <Video size={12} /> Online
            </span>
          )}
          {e.attendeeIds.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <UsersRound size={12} /> {e.attendeeIds.length}
            </span>
          )}
          <TagChips ids={e.tagIds} max={2} />
        </div>
      </div>
      {!swipe && (
        <Menu
          items={[
            { label: "Mark done", onClick: () => void set("done"), hidden: !scheduled },
            { label: "Cancel this date", onClick: () => void set("cancelled"), hidden: !scheduled },
            { label: "Open (move, delete…)", onClick: open },
            { label: "Edit", onClick: () => openEventForm({ kind: "edit", event: e }) },
          ]}
        />
      )}
    </SwipeRow>
  );
}

