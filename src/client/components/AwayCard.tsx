// Away today and tomorrow (user request 2026-11-02, docs/ATTENDANCE_ASSIST_PLAN.md 3.3, phase 2): at the top of the
// Attendance page's Today tab, everyone off, on CL, ½CL, CH, absent or on leave today and tomorrow (an off planned
// counts), each name opening their Person days; and the CH that must be taken within a week. Fresh each time.
import type { AwayPerson } from "../../shared/types";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAway } from "../api";
import { openPersonDays } from "./PersonDays";
import { cx } from "./ui";

const KIND_LOOK: Record<AwayPerson["kind"], string> = {
  off: "bg-brand-50 text-brand-700",
  planned: "border border-dashed border-brand-500 text-brand-700",
  cl: "bg-high-soft text-high-ink",
  cl_half: "bg-high-soft text-high-ink",
  ch: "bg-info-soft text-info-ink",
  absent: "bg-urgent-soft text-urgent-ink",
  holiday: "bg-slate-100 text-slate-600",
  leave: "bg-snooze-soft text-snooze-ink",
};

export function AwayCard() {
  const { data } = useAway();
  if (!data) return null;
  const [today, tomorrow] = data.days;
  return (
    <div className="mb-3 rounded-xl border border-line bg-white p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { label: "Away today", day: today },
          { label: "Tomorrow", day: tomorrow },
        ].map(({ label, day }) =>
          day ? (
            <section key={day.date} className="min-w-0">
              <h2 className="text-footnote font-semibold text-slate-600">
                {label} <span className="font-normal text-slate-400">· {dayLabel(day.date).replace(/ \d{4}$/, "")}</span>
              </h2>
              {day.people.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">Nobody away</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {day.people.map((p) => (
                    <li key={p.employeeId} className="min-w-0">
                      <button type="button" onClick={() => openPersonDays(p.employeeId)} className="flex max-w-full items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-left text-sm hover:bg-slate-50 active:scale-[0.97]">
                        <span className="min-w-0 truncate text-ink">{p.name}</span>
                        <span className={cx("shrink-0 rounded px-1 text-caption font-medium whitespace-nowrap", KIND_LOOK[p.kind])}>{p.what}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null,
        )}
      </div>
      {data.chLapsing.length > 0 && (
        <p className="mt-2 border-t border-line pt-2 text-footnote text-urgent-ink [overflow-wrap:anywhere]">
          CH to take within a week: {data.chLapsing.map((c) => `${c.name} (${c.holidayName}, by ${dayLabel(c.expires).replace(/ \d{4}$/, "")})`).join("; ")}
        </p>
      )}
    </div>
  );
}
