// Settings > Events (user request 2026-10-12, "add, edit or delete event types in Settings"): the types offered in
// the event form (Meeting, Training, Programme…). Add, rename, arrange by drag and drop, add the usual ones, and
// remove — also a type events have: they stay, shown as "Event".
import { useMemo } from "react";
import { Link } from "react-router";
import { CalendarRange, ChevronRight } from "lucide-react";
import { DEFAULT_EVENT_TYPES } from "../../shared/eventSchedule";
import { useEventTypeActions, useEventTypes } from "../api";
import { NameList } from "./Designations";
import { Card, ErrorNote, Loading } from "./ui";

export function EventTypeSettings() {
  const { data, error } = useEventTypes();
  const a = useEventTypeActions();
  const counts = useMemo(() => new Map((data?.types ?? []).map((t) => [t.id, t.events])), [data]);
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <CalendarRange size={18} className="text-brand-700" /> Events
      </h2>
      <p className="mt-1 text-sm text-slate-600">The types of events you keep, offered in this order when you add an event.</p>
      <Link to="/events" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        Open the Events page <ChevronRight size={15} />
      </Link>
      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Loading className="py-4" />
      ) : (
        <NameList
          title="Event types"
          items={data.types}
          counts={counts}
          unit="event"
          common={DEFAULT_EVENT_TYPES}
          commonText="Add Meeting, Training and Programme. You can rename or remove any."
          commonButton={(n, all) => (all ? "Add these types" : `Add ${n} more`)}
          placeholder="New type, e.g. Workshop"
          label="event type"
          confirmText={(t) => {
            const n = counts.get(t.id) ?? 0;
            return n ? `Remove the event type "${t.name}"? Its ${n} event${n === 1 ? "" : "s"} stay, shown as "Event".` : `Remove the event type "${t.name}"?`;
          }}
          footnote="Removing a type keeps its events; they show as “Event” until you choose another type."
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
