// Leave log (user request 2026-11-09, "a button to view a log of all leaves in chronological order, with filters for the
// type of leave (CL, CH, earned leave, commuted, HPL, hysterectomy…) and employees, and an option to print; don't
// include off, CH-off, holiday / SS"): `/attendance/leave-log`, opened from the Attendance page's Leave log button.
// Every CL, half day CL and CH of the register and every leave of the Leave page from–to (this year to start), oldest
// first (GET /attendance/leave-log; CL / CH days in a row are one line), filtered here by type and employee. Print gives
// an A4 page with the office's name, the period and the filters chosen, the list and a total by type; the filters,
// buttons and app frame aren't printed.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, Printer } from "lucide-react";
import { dayLabel } from "../../shared/reminderSchedule";
import { formatDays } from "../../shared/leave";
import type { LeaveLogEntry } from "../../shared/leaveLog";
import { useLeaveLog, useMe, useOfficeProfile } from "../api";
import { LEAVE_BAND, MARK_COLOR } from "../markColors";
import { RefreshButton } from "../components/RefreshButton";
import { Button, Card, ErrorNote, SkeletonList, cx, inputClass } from "../components/ui";

const range = (e: LeaveLogEntry) => (e.from === e.to ? dayLabel(e.from) : `${dayLabel(e.from)} to ${dayLabel(e.to)}`);
// The type's look: the register's marks in their colours, Leave page leave as the grey leave band.
const typeLook = (e: LeaveLogEntry) => (e.kind === "leave" ? cx("rounded px-1.5", LEAVE_BAND) : MARK_COLOR[e.kind]);

export function LeaveLogPage() {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [type, setType] = useState("");
  const [who, setWho] = useState("");
  const { data, error, isFetching } = useLeaveLog(from, to);
  const office = useOfficeProfile().data?.profile.officeName;

  const people = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data]);
  const shown = useMemo(() => (data?.entries ?? []).filter((e) => (!type || e.filter === type) && (!who || e.employeeId === who)), [data, type, who]);
  // Days of each type in the list, in the filter's order.
  const totals = useMemo(() => {
    const sum = new Map<string, number>();
    for (const e of shown) sum.set(e.filter, (sum.get(e.filter) ?? 0) + e.days);
    return (data?.types ?? []).filter((t) => sum.has(t.filter)).map((t) => ({ ...t, days: sum.get(t.filter)! }));
  }, [shown, data]);
  // The employee filter: everyone with leave in the period, by designation.
  const groups = useMemo(() => {
    const out: { name: string; list: NonNullable<typeof data>["people"] }[] = [];
    for (const p of data?.people ?? []) {
      const name = p.designation ?? "No designation";
      const g = out.find((x) => x.name === name);
      g ? g.list.push(p) : out.push({ name, list: [p] });
    }
    return out;
  }, [data]);
  const typeName = data?.types.find((t) => t.filter === type)?.name;
  const person = who ? people.get(who) : undefined;
  const label = "block text-footnote font-medium text-slate-600";

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <Link to="/attendance" className="inline-flex items-center gap-0.5 rounded-lg py-1 pr-2 text-footnote font-medium text-brand-700 hover:underline">
          <ChevronLeft size={16} aria-hidden /> Register
        </Link>
        <h1 className="min-w-0 flex-1 text-title3 font-bold text-ink md:font-semibold">Leave log</h1>
        <RefreshButton keys={[["attendance", "leave-log"]]} label="Refresh the leave log" />
        <Button size="sm" onClick={() => window.print()} disabled={!data}>
          <Printer size={15} /> Print
        </Button>
      </div>

      {/* Filters: the period, the type of leave, the employee. */}
      <Card className="mb-3 grid grid-cols-2 gap-x-2 gap-y-2.5 p-3 sm:gap-3 lg:grid-cols-[repeat(2,minmax(0,10rem))_auto_minmax(0,1fr)_minmax(0,1fr)] lg:items-end print:hidden">
        <label className="block space-y-1">
          <span className={label}>From</span>
          <input type="date" className={cx(inputClass, "min-w-0")} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className={label}>To</span>
          <input type="date" className={cx(inputClass, "min-w-0")} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <div className="col-span-2 -my-1 flex flex-wrap gap-2 lg:col-span-1 lg:my-0">
          <Button size="sm" variant="ghost" aria-pressed={from === `${year}-01-01` && to === `${year}-12-31`} onClick={() => (setFrom(`${year}-01-01`), setTo(`${year}-12-31`))}>
            This year
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (setFrom(`${Number(year) - 1}-01-01`), setTo(`${Number(year) - 1}-12-31`))}>
            {Number(year) - 1}
          </Button>
        </div>
        <label className="col-span-2 block space-y-1 sm:col-span-1">
          <span className={label}>Type of leave</span>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All leave</option>
            {(data?.types ?? []).map((t) => (
              <option key={t.filter} value={t.filter}>
                {t.label === t.name ? t.name : `${t.label} — ${t.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block space-y-1 sm:col-span-1">
          <span className={label}>Employee</span>
          <select className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {groups.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.left ? " (left)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </Card>

      <ErrorNote error={error} />
      {!data ? (
        <SkeletonList rows={6} />
      ) : (
        <Card className={cx("overflow-hidden print:rounded-none print:border-0 print:shadow-none", isFetching && "opacity-70")}>
          {/* The heading, as on the register (printed too). */}
          <div className="border-b-4 border-double border-slate-300 px-4 py-3 text-center">
            <p className="font-serif text-title3 font-bold tracking-[0.2em] text-ink uppercase">Leave log</p>
            {office && <p className="font-serif text-subhead text-slate-700 [overflow-wrap:anywhere]">{office}</p>}
            <p className="font-serif text-subhead text-slate-600">
              {dayLabel(data.from)} to {dayLabel(data.to)}
              {typeName && ` · ${typeName}`}
              {person && ` · ${person.name}`}
            </p>
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No leave in this period{type || who ? " for the filters chosen" : ""}.</p>
          ) : (
            <>
              {/* Computers and paper: a ruled table. */}
              <div className="hidden md:block print:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="font-serif text-left text-slate-700">
                      <th className="w-12 border-b border-slate-300 px-3 py-2 font-semibold">Sl</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Date</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Employee</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Leave</th>
                      <th className="w-16 border-b border-slate-300 px-3 py-2 text-right font-semibold">Days</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e, i) => {
                      const p = people.get(e.employeeId);
                      return (
                        <tr key={`${e.employeeId}|${e.filter}|${e.from}`} className="break-inside-avoid align-top">
                          <td className="border-b border-line px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                          <td className="border-b border-line px-3 py-2 whitespace-nowrap text-ink tabular-nums">{range(e)}</td>
                          <td className="border-b border-line px-3 py-2">
                            <span className="block text-ink [overflow-wrap:anywhere]">{p?.name}</span>
                            {p?.designation && <span className="block text-footnote text-slate-500">{p.designation}</span>}
                          </td>
                          <td className="border-b border-line px-3 py-2" title={e.typeName}>
                            <span className={cx("text-footnote font-semibold", typeLook(e))}>{e.type}</span>
                          </td>
                          <td className="border-b border-line px-3 py-2 text-right text-ink tabular-nums">{formatDays(e.days)}</td>
                          <td className="border-b border-line px-3 py-2 text-footnote text-slate-600 [overflow-wrap:anywhere]">
                            {e.details}
                            {e.notes && <span className="block whitespace-pre-line text-slate-500 select-text">{e.notes}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Phones: a line each. */}
              <ul className="divide-y divide-line md:hidden print:hidden">
                {shown.map((e) => {
                  const p = people.get(e.employeeId);
                  return (
                    <li key={`${e.employeeId}|${e.filter}|${e.from}`} className="px-3 py-2">
                      <p className="flex items-baseline justify-between gap-2 text-footnote text-slate-600">
                        <span className="tabular-nums">{range(e)}</span>
                        <span className="shrink-0 tabular-nums">{formatDays(e.days)} {e.days === 1 ? "day" : "days"}</span>
                      </p>
                      <p className="flex items-baseline gap-2">
                        <span className={cx("shrink-0 text-footnote font-semibold", typeLook(e))} title={e.typeName}>
                          {e.type}
                        </span>
                        <span className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">{p?.name}</span>
                      </p>
                      {(e.details || e.notes) && <p className="text-caption text-slate-500 [overflow-wrap:anywhere]">{[e.details, e.notes].filter(Boolean).join(" · ")}</p>}
                    </li>
                  );
                })}
              </ul>
              {/* Days of each type in the list. */}
              <p className="border-t border-line px-4 py-2 text-footnote text-slate-600">
                {shown.length} {shown.length === 1 ? "entry" : "entries"}
                {totals.map((t) => ` · ${t.label} ${formatDays(t.days)} ${t.days === 1 ? "day" : "days"}`).join("")}
              </p>
            </>
          )}
        </Card>
      )}
    </>
  );
}
