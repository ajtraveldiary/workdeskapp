// Settings › Attendance (user request 2026-10-31, docs/ATTENDANCE_PLAN.md phase 1): the office's holidays month by
// month (tap a date to make it a holiday and name it, tap again to rename or remove it), second Saturdays as
// holidays (a switch) and the days of casual leave a year. The register shades these days for everyone.
import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { DEFAULT_ATTENDANCE_SETTINGS, WEEKDAY_LETTER, isSecondSaturday, monthDays, monthLabel, shiftMonth, weekdayOf } from "../../shared/attendance";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAttendanceActions, useAttendanceSettings, useHolidays, useMe } from "../api";
import { Button, Card, ErrorNote, Loading, cx, inputClass } from "./ui";

export function AttendanceSettings() {
  return (
    <>
      <HolidayCalendar />
      <RegisterSettings />
    </>
  );
}

function HolidayCalendar() {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7));
  const year = month.slice(0, 4);
  const { data } = useHolidays(year);
  const settings = useAttendanceSettings().data?.settings ?? DEFAULT_ATTENDANCE_SETTINGS;
  const { saveHoliday, removeHoliday } = useAttendanceActions();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const byDate = new Map((data?.holidays ?? []).map((h) => [h.date, h.name]));
  const days = monthDays(month);
  const lead = weekdayOf(days[0]!);
  const open = (date: string) => {
    setEditing(editing === date ? null : date);
    setName(byDate.get(date) ?? "");
  };
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (editing) saveHoliday.mutate({ date: editing, name: name.trim() }, { onSuccess: () => setEditing(null) });
  };
  const listed = days.filter((d) => byDate.has(d) || (settings.secondSaturday && isSecondSaturday(d)));
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <CalendarDays size={18} className="text-brand-700" /> Holidays
      </h2>
      <p className="mt-1 text-sm text-slate-600">Tap a date to make it a holiday and name it; tap it again to rename or remove it. The attendance register shades holidays for everyone, and work on them is holiday duty.</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
          <ChevronLeft size={18} />
        </button>
        <span className="font-medium text-ink">{monthLabel(month)}</span>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
          <ChevronRight size={18} />
        </button>
      </div>
      {!data ? (
        <Loading className="py-6" />
      ) : (
        <div className="mt-2 grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_LETTER.map((w, i) => (
            <span key={i} className={cx("py-1 text-caption font-medium", i === 0 ? "text-urgent-ink" : "text-slate-500")}>
              {w}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((d) => {
            const named = byDate.has(d);
            const second = settings.secondSaturday && isSecondSaturday(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => open(d)}
                aria-pressed={editing === d}
                title={named ? byDate.get(d) || "Holiday" : second ? "Second Saturday" : undefined}
                className={cx(
                  "no-tap flex h-11 flex-col items-center justify-center rounded-lg border text-sm transition active:scale-95 aria-pressed:ring-2 aria-pressed:ring-brand-500",
                  named ? "border-urgent-soft bg-urgent-soft font-semibold text-urgent-ink" : second ? "border-dashed border-slate-300 bg-slate-50 text-slate-500" : "border-transparent text-ink hover:bg-slate-50",
                  d === today && "underline underline-offset-4",
                  weekdayOf(d) === 0 && !named && "text-urgent-ink",
                )}
              >
                {Number(d.slice(8))}
                {(named || second) && <span className="max-w-full truncate px-0.5 text-caption2 font-normal">{named ? byDate.get(d) || "Holiday" : "2nd Sat"}</span>}
              </button>
            );
          })}
        </div>
      )}
      {editing && (
        <form onSubmit={save} className="mt-3 space-y-2 rounded-lg border border-line p-3">
          <p className="text-sm font-medium text-ink">Holiday on {dayLabel(editing)}</p>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Name, e.g. Gandhi Jayanthi" autoFocus />
          <div className="flex flex-wrap items-center gap-2">
            {byDate.has(editing) && (
              <Button type="button" variant="danger" onClick={() => removeHoliday.mutate(editing, { onSuccess: () => setEditing(null) })} disabled={removeHoliday.isPending} className="mr-auto">
                <Trash2 size={15} /> Not a holiday
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setEditing(null)} className="ml-auto">
              <X size={15} /> Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saveHoliday.isPending}>
              <Check size={15} /> {byDate.has(editing) ? "Save" : "Make it a holiday"}
            </Button>
          </div>
        </form>
      )}
      <ErrorNote error={saveHoliday.error ?? removeHoliday.error} />
      {data && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {listed.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-500">No holidays in {monthLabel(month)}.</li>
          ) : (
            listed.map((d) => (
              <li key={d} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-slate-500 tabular-nums">{dayLabel(d)}</span>
                <span className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{byDate.has(d) ? byDate.get(d) || "Holiday" : "Second Saturday"}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </Card>
  );
}

function RegisterSettings() {
  const { data } = useAttendanceSettings();
  const { saveSettings } = useAttendanceActions();
  const [cl, setCl] = useState("");
  useEffect(() => {
    if (data) setCl(String(data.settings.clPerYear));
  }, [data]);
  if (!data) return null;
  const s = data.settings;
  const n = Number(cl);
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Register</h2>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
        <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={s.secondSaturday} onChange={(e) => saveSettings.mutate({ ...s, secondSaturday: e.target.checked })} />
        <span className="text-sm text-ink">Second Saturdays are holidays</span>
      </label>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Casual leave a year (days)</span>
          <input type="number" inputMode="numeric" min={0} max={60} className={cx(inputClass, "w-28")} value={cl} onChange={(e) => setCl(e.target.value)} />
        </label>
        {cl !== String(s.clPerYear) && (
          <Button onClick={() => saveSettings.mutate({ ...s, clPerYear: n })} disabled={!Number.isInteger(n) || n < 0 || n > 60 || saveSettings.isPending}>
            <Check size={15} /> Save
          </Button>
        )}
      </div>
      <p className="mt-1 text-footnote text-slate-500">KSR Part I, Appendix VII: 20 days in a calendar year. The register warns when someone goes past it.</p>
      <ErrorNote error={saveSettings.error} />
    </Card>
  );
}
