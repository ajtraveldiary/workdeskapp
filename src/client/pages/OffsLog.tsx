// Offs log (user request 2026-11-10, "a button to view a log of all offs, C-offs, holiday / SS for weekly-off staff, with
// a filter for staff and type of off"): `/attendance/offs-log`, opened from the Attendance page's Offs log button. Every
// off and holiday taken (H / SS) of weekly-off staff from–to (this year to start), oldest first (GET
// /attendance/offs-log): Off, C-off (it pays back the compensatory off, user's answer), H, SS; an off taken before it was
// earned says so. Filtered here by type and staff member; Print gives an A4 page with the office's name, the period
// and the filters chosen, the list and the count of each type; the filters, buttons and app frame aren't printed.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, Printer } from "lucide-react";
import { dayLabel } from "../../shared/reminderSchedule";
import { OFF_KINDS, type OffKind } from "../../shared/offsLog";
import { useMe, useOffsLog, useOfficeProfile } from "../api";
import { MARK_COLOR } from "../markColors";
import { RefreshButton } from "../components/RefreshButton";
import { Button, Card, ErrorNote, SkeletonList, cx, inputClass } from "../components/ui";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
// Offs in the register's off colour (C-off the same, bolder), holidays taken in its holiday grey.
const LOOK: Record<OffKind, string> = { off: MARK_COLOR.off, coff: cx(MARK_COLOR.off, "underline decoration-dotted"), h: MARK_COLOR.holiday, ss: MARK_COLOR.holiday };

export function OffsLogPage() {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [type, setType] = useState<OffKind | "">("");
  const [who, setWho] = useState("");
  const { data, error, isFetching } = useOffsLog(from, to);
  const office = useOfficeProfile().data?.profile.officeName;

  const people = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data]);
  const shown = useMemo(() => (data?.entries ?? []).filter((e) => (!type || e.kind === type) && (!who || e.employeeId === who)), [data, type, who]);
  const counts = useMemo(() => OFF_KINDS.map((k) => ({ ...k, n: shown.filter((e) => e.kind === k.kind).length })).filter((k) => k.n > 0), [shown]);
  const groups = useMemo(() => {
    const out: { name: string; list: NonNullable<typeof data>["people"] }[] = [];
    for (const p of data?.people ?? []) {
      const name = p.designation ?? "No designation";
      const g = out.find((x) => x.name === name);
      g ? g.list.push(p) : out.push({ name, list: [p] });
    }
    return out;
  }, [data]);
  const kindOf = (k: OffKind) => OFF_KINDS.find((x) => x.kind === k)!;
  const person = who ? people.get(who) : undefined;
  const label = "block text-footnote font-medium text-slate-600";

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <Link to="/attendance" className="inline-flex items-center gap-0.5 rounded-lg py-1 pr-2 text-footnote font-medium text-brand-700 hover:underline">
          <ChevronLeft size={16} aria-hidden /> Register
        </Link>
        <h1 className="min-w-0 flex-1 text-title3 font-bold text-ink md:font-semibold">Offs log</h1>
        <RefreshButton keys={[["attendance", "offs-log"]]} label="Refresh the offs log" />
        <Button size="sm" onClick={() => window.print()} disabled={!data}>
          <Printer size={15} /> Print
        </Button>
      </div>

      {/* Filters: the period, the type of off, the staff member. */}
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
          <span className={label}>Type of off</span>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as OffKind | "")}>
            <option value="">All</option>
            {OFF_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label} — {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block space-y-1 sm:col-span-1">
          <span className={label}>Staff</span>
          <select className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All weekly-off staff</option>
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
          <div className="border-b-4 border-double border-slate-300 px-4 py-3 text-center">
            <p className="font-serif text-title3 font-bold tracking-[0.2em] text-ink uppercase">Offs log</p>
            {office && <p className="font-serif text-subhead text-slate-700 [overflow-wrap:anywhere]">{office}</p>}
            <p className="font-serif text-subhead text-slate-600">
              Weekly-off staff · {dayLabel(data.from)} to {dayLabel(data.to)}
              {type && ` · ${kindOf(type).name}`}
              {person && ` · ${person.name}`}
            </p>
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No offs in this period{type || who ? " for the filters chosen" : ""}.</p>
          ) : (
            <>
              <div className="hidden md:block print:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="font-serif text-left text-slate-700">
                      <th className="w-12 border-b border-slate-300 px-3 py-2 font-semibold">Sl</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Date</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Staff</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Type</th>
                      <th className="border-b border-slate-300 px-3 py-2 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e, i) => {
                      const p = people.get(e.employeeId);
                      return (
                        <tr key={`${e.employeeId}|${e.date}`} className="break-inside-avoid align-top">
                          <td className="border-b border-line px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                          <td className="border-b border-line px-3 py-2 whitespace-nowrap text-ink tabular-nums">
                            {weekday(e.date)} {dayLabel(e.date)}
                          </td>
                          <td className="border-b border-line px-3 py-2">
                            <span className="block text-ink [overflow-wrap:anywhere]">{p?.name}</span>
                            {p?.designation && <span className="block text-footnote text-slate-500">{p.designation}</span>}
                          </td>
                          <td className="border-b border-line px-3 py-2" title={kindOf(e.kind).name}>
                            <span className={cx("text-footnote", LOOK[e.kind])}>{kindOf(e.kind).label}</span>
                          </td>
                          <td className="border-b border-line px-3 py-2 text-footnote text-slate-600 [overflow-wrap:anywhere]">{e.details}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line md:hidden print:hidden">
                {shown.map((e) => {
                  const p = people.get(e.employeeId);
                  return (
                    <li key={`${e.employeeId}|${e.date}`} className="flex items-baseline gap-3 px-3 py-2">
                      <span className="w-24 shrink-0 text-footnote text-slate-600 tabular-nums">
                        {weekday(e.date)} {dayLabel(e.date).slice(0, 5)}
                      </span>
                      <span className={cx("w-11 shrink-0 text-footnote", LOOK[e.kind])} title={kindOf(e.kind).name}>
                        {kindOf(e.kind).label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink [overflow-wrap:anywhere]">{p?.name}</span>
                        {e.details && <span className="block text-caption text-slate-500">{e.details}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-line px-4 py-2 text-footnote text-slate-600">
                {shown.length} {shown.length === 1 ? "entry" : "entries"}
                {counts.map((k) => ` · ${k.label} ${k.n}`).join("")}
              </p>
            </>
          )}
        </Card>
      )}
    </>
  );
}
