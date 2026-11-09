// Add a holiday worked from inside a CH pop-up (user request 2026-11-03, "while marking CH, if no date is available, add
// an option to add a holiday working in that same popup, instead of going inside the settings"): the day (within the 3
// months before the CH), and its name when it isn't a holiday of the register yet (it becomes one, as in Settings ›
// Attendance); the person is then marked on duty that day (holiday duty, over any mark there), so the holiday is open
// for the CH straight away. Used by the register's ChPicker and Person days' ChChoose.
import { useState } from "react";
import { Plus } from "lucide-react";
import { addMonths, isSecondSaturday } from "../../shared/attendance";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAttendanceActions, useAttendanceSettings, useHolidays, useMe } from "../api";
import { Button, ErrorNote, cx, inputClass } from "./ui";

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

// sundayOff: a Sunday-off person, whose Sundays are holidays worked too (2026-11-09: a Sunday worked earns them a CH).
export function HolidayWorkedForm({ employeeId, before, onAdded, sundayOff }: { employeeId: string; before: string; onAdded?: (holiday: string) => void; sundayOff?: boolean }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [said, setSaid] = useState("");
  const settings = useAttendanceSettings().data?.settings;
  const holidays = useHolidays((date || before).slice(0, 4)).data?.holidays;
  const { saveHoliday, mark } = useAttendanceActions();
  const existing = date ? holidays?.find((h) => h.date === date) : undefined;
  const second = !!date && !!settings?.secondSaturday && isSecondSaturday(date);
  const sunday = !!date && !!sundayOff && new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
  const isHoliday = !!existing || second || sunday;
  const latest = [dayBefore(before), today].sort()[0]!;
  const earliest = addMonths(before, -3);
  const busy = saveHoliday.isPending || mark.isPending;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1 text-footnote font-medium text-brand-700 hover:underline">
        <Plus size={14} /> Add a holiday worked
      </button>
    );
  const add = async () => {
    setSaid("");
    if (!isHoliday) await saveHoliday.mutateAsync({ date, name: name.trim() });
    const r = await mark.mutateAsync({ cells: [{ employeeId, date }], mark: "present", replace: true });
    if (!r.marked && !r.skipped["already marked"]) {
      setSaid(`Not marked: ${Object.keys(r.skipped).join(", ")}`);
      return;
    }
    setOpen(false);
    setDate("");
    setName("");
    onAdded?.(date);
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-dashed border-line p-2.5">
      <p className="text-footnote text-slate-600">A holiday they worked, within the 3 months before {dayLabel(before)}: it is marked as holiday duty and offered for the CH.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="block text-caption text-slate-500">Day worked</span>
          <input type="date" className={cx(inputClass, "mt-0.5 w-auto")} min={earliest} max={latest} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {date && !isHoliday && (
          <label className="block min-w-0 flex-1 basis-40">
            <span className="block text-caption text-slate-500">Holiday's name (it is added to the holidays)</span>
            <input className={cx(inputClass, "mt-0.5 w-full")} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Onam" />
          </label>
        )}
        {date && isHoliday && <span className="pb-2 text-footnote text-slate-600">{existing ? existing.name || "Holiday" : second ? "Second Saturday" : "Sunday"}</span>}
      </div>
      {date && (date < earliest || date > latest) && <p className="text-footnote text-urgent-ink">Pick a day from {dayLabel(earliest)} to {dayLabel(latest)}.</p>}
      {said && <p className="text-footnote text-urgent-ink">{said}</p>}
      <ErrorNote error={saveHoliday.error ?? mark.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant="primary" disabled={!date || date < earliest || date > latest || busy} onClick={() => void add()}>
          Add holiday worked
        </Button>
      </div>
    </div>
  );
}
