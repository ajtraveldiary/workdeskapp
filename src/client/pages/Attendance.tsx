// Attendance register (user request 2026-10-31, docs/ATTENDANCE_PLAN.md phase 1). On wider screens it looks like a
// page of the paper register: the title, the office's name and the month, then a ruled table with a row per person
// (Sl, name, the year's CL and CH) and a column per day. Tap a day's number to select everyone that day, a name for
// their month, or cells one by one (drag or shift-click for a range), then mark them Present, Off, CL, ½CL or Absent
// from the bar at the bottom, or clear them. Holidays (Settings › Attendance) and Sunday-off staff's Sundays are
// shaded; leave from the Leave page fills its days, read-only. Phones show one day at a time. Phase 2: Mark CH asks
// which holiday worked each CH is for (ChPicker); a holiday worked shows a dot (blue while its CH is open); the
// CL / CH column adds the CH open and, for weekly-off staff, the offs due; days past 12 in a row are outlined red;
// the bar warns about offs not earned, CL / CH with holidays past 15 days (across the month's edges too), CH limits,
// CH held past 10 and a run of days that marking would take past 12; CH that must be taken within a week are listed
// above the register; the CL / CH cell opens the person's figures (DetailsDialog), and phones show them in each row.
// Phase 3: the month's summary under the register (MonthSummary), Print (A4 landscape, the register and the summary
// with signature lines; nothing of the app around it) and Download (the month as a CSV, like the page).
// No page title or help line (user request 2026-10-31, "no need of text and blank space"): one toolbar row with the
// month, Summary, Download, Print, refresh and Holidays. Summary opens the month's summary in a pop-up (user request
// 2026-10-31); printing always adds it under the register with the signature lines. The register's columns share the
// page's width (a fixed table layout; day columns grow and shrink) and it scrolls sideways only below about 740px.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarClock, Check, ChevronLeft, ChevronRight, ClipboardCheck, Download, Eraser, Printer, Sigma, X } from "lucide-react";
import type { AttendanceMonth } from "../../shared/types";
import { CH_HOLD_MAX, CL_RUN_MAX, MARK_NAME, MARK_SHORT, WEEKDAY_LETTER, awayDay, chFits, clDays, monthCounts, monthLabel, offByItself, shiftMonth, weeklyOff, type AttendanceMark, type ChOpen, type WeeklyDay } from "../../shared/attendance";
import { toCsv } from "../../shared/transfer";
import { saveFile } from "../saveFile";
import { dayLabel } from "../../shared/reminderSchedule";
import { OFF_DAY_LABELS } from "../../shared/staff";
import { useAttendance, useAttendanceActions, useMe, useOfficeProfile, type AttendanceCell } from "../api";
import { RefreshButton } from "../components/RefreshButton";
import { showUndo } from "../components/SwipeRow";
import { Button, Card, ErrorNote, Modal, SkeletonList, cx, inputClass } from "../components/ui";

type Person = AttendanceMonth["employees"][number];
type Markable = Exclude<AttendanceMark, "ch">;
const key = (employeeId: string, date: string) => `${employeeId}|${date}`;
const unkey = (k: string): AttendanceCell => {
  const [employeeId, date] = k.split("|") as [string, string];
  return { employeeId, date };
};
const MARK_TONE: Record<AttendanceMark, string> = {
  present: "font-semibold text-low-ink",
  off: "font-medium text-slate-500",
  cl: "font-semibold text-high-ink",
  cl_half: "font-semibold text-high-ink",
  ch: "font-semibold text-info-ink",
  absent: "font-bold text-urgent-ink",
};
const WIDE = "(min-width: 768px)";
// The register's set columns (the day columns share what is left): Sl · Name and CL / CH, wider on bigger screens;
// TOTALS_LEFT keeps the CL / CH column beside the name while the table scrolls sideways.
const NAME_COL = "w-36 xl:w-44 2xl:w-52";
const TOTALS_COL = "w-16";
const TOTALS_LEFT = "left-36 xl:left-44 2xl:left-52";
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

// What one cell holds: not in the office, leave from the Leave page, or a mark (or nothing), on a working day or a
// day off by itself (holiday, Sunday for Sunday-off staff).
type CellInfo = { out: true } | { out: false; leave: { short: string; name: string; from: string; to: string } | null; mark: AttendanceMark | null; holiday: boolean };
function useCells(data: AttendanceMonth | undefined) {
  return useMemo(() => {
    if (!data) return null;
    const marks = new Map(data.marks.map((m) => [key(m.employeeId, m.date), m.mark]));
    const holidayOf = new Map(data.days.map((d) => [d.date, d.holiday]));
    const info = (e: Person, date: string): CellInfo => {
      if ((e.from && date < e.from) || (e.until && date > e.until)) return { out: true };
      const leave = data.leaves.find((l) => l.employeeId === e.id && l.from <= date && date <= l.to) ?? null;
      return { out: false, leave, mark: marks.get(key(e.id, date)) ?? null, holiday: offByItself(date, holidayOf.get(date) ?? null, e.offDay) };
    };
    const selectable = (e: Person, date: string) => {
      const c = info(e, date);
      return !c.out && !c.leave;
    };
    // A day off by itself for them (holiday, Sunday-off staff's Sunday).
    const holiday = (e: Person, date: string) => {
      const c = info(e, date);
      return !c.out && c.holiday;
    };
    // A working day nobody has marked yet.
    const unmarked = (e: Person, date: string) => {
      const c = info(e, date);
      return !c.out && !c.leave && !c.holiday && !c.mark;
    };
    return { info, selectable, holiday, unmarked, marks };
  }, [data]);
}

export function AttendancePage() {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : today.slice(0, 7);
  const setMonth = (m: string) => setParams(m === today.slice(0, 7) ? {} : { month: m }, { replace: true });
  const { data, error } = useAttendance(month);
  const cells = useCells(data);
  const wide = useWide();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A new month starts with nothing selected.
  useEffect(() => setSelected(new Set()), [month]);
  // The month's summary, in a pop-up opened by Summary.
  const [summary, setSummary] = useState(false);

  return (
    <>
      <h1 className="sr-only">Attendance register</h1>
      <div className="-mt-2 mb-2 flex flex-wrap items-center gap-1 print:hidden sm:-mt-3">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
          <ChevronLeft size={18} />
        </button>
        <span className="text-center font-medium whitespace-nowrap text-ink sm:min-w-36">{monthLabel(month)}</span>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
          <ChevronRight size={18} />
        </button>
        {month !== today.slice(0, 7) && (
          <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>
            This month
          </Button>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {data && data.employees.length > 0 && (
            <>
              <Button size="sm" variant="ghost" aria-haspopup="dialog" onClick={() => setSummary(true)} title="Show the month's summary">
                <Sigma size={15} /> Summary
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadMonth(data)} aria-label="Download the month as a CSV file">
                <Download size={15} /> <span className="hidden sm:inline">Download</span>
              </Button>
              {/* Printing is for the register's page (computers). */}
              {wide && (
                <Button size="sm" variant="ghost" onClick={() => window.print()} aria-label="Print the month">
                  <Printer size={15} /> Print
                </Button>
              )}
            </>
          )}
          <RefreshButton keys={[["attendance"]]} label="Refresh the register" />
          <Link to="/settings#attendance" className="hidden h-8 items-center rounded-lg px-3 text-footnote font-medium text-brand-700 hover:bg-slate-50 sm:inline-flex">
            Holidays
          </Link>
        </span>
      </div>
      <ErrorNote error={error} />
      {!data || !cells ? (
        <SkeletonList rows={6} />
      ) : data.employees.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-500">No employees in the office in {monthLabel(month)}. Add them on the Employees page.</Card>
      ) : wide ? (
        <>
          <div className="print:hidden">
            <ChDueSoon data={data} />
          </div>
          <Register data={data} cells={cells} selected={selected} setSelected={setSelected} />
          {/* Only on paper: the summary and the signature lines under the register. */}
          <div className="hidden print:block">
            <MonthSummary data={data} />
          </div>
        </>
      ) : (
        <>
          <ChDueSoon data={data} />
          <DayView data={data} cells={cells} selected={selected} setSelected={setSelected} onMonth={setMonth} />
        </>
      )}
      {data && (
        <Modal open={summary} onClose={() => setSummary(false)} title={`Summary for ${monthLabel(data.month)}`} wide closeOnBackdrop>
          <MonthSummary data={data} bare />
        </Modal>
      )}
      {data && cells && selected.size > 0 && (
        <>
          <div className="h-36 md:hidden" aria-hidden />
          <ActionBar data={data} cells={cells} selected={selected} onDone={() => setSelected(new Set())} />
        </>
      )}
    </>
  );
}

type Cells = NonNullable<ReturnType<typeof useCells>>;
type SelectProps = { data: AttendanceMonth; cells: Cells; selected: Set<string>; setSelected: (s: Set<string>) => void };

// CH and weekly-off figures by person and cell.
function useChLookups(data: AttendanceMonth) {
  return useMemo(() => {
    const open = new Map<string, ChOpen[]>();
    for (const o of data.chOpen) if (o.expires >= data.today) open.set(o.employeeId, [...(open.get(o.employeeId) ?? []), o]);
    return {
      open,
      forCell: new Map(data.chFor.map((x) => [key(x.employeeId, x.date), x.holiday])),
      taken: new Set(data.chFor.map((x) => key(x.employeeId, x.holiday))),
      weekly: new Map(data.weekly.map((w) => [w.employeeId, w])),
      long: new Set(data.weekly.flatMap((w) => w.long.map((d) => key(w.employeeId, d)))),
      limit: new Map(data.chLimits.map((x) => [x.employeeId, x.limit])),
      edges: new Map(data.edges.map((x) => [x.employeeId, x])),
    };
  }, [data]);
}
type Lookups = ReturnType<typeof useChLookups>;

// CL and CH this year, the CH still to take (+n, red when one must be taken within a week) and, for weekly-off
// staff, the offs due.
// Tapping it opens the person's figures (DetailsDialog), so they are reachable by touch too.
function TotalsCell({ id, cl, ch, data, lookups, onOpen }: { id: string; cl: number; ch: number; data: AttendanceMonth; lookups: Lookups; onOpen: () => void }) {
  const open = lookups.open.get(id) ?? [];
  const soon = open.some((o) => o.expires <= addDays(data.today, 7));
  const w = lookups.weekly.get(id);
  const limit = lookups.limit.get(id);
  return (
    <td className={cx("sticky z-10 border border-slate-300 bg-white p-0 text-center leading-tight tabular-nums", TOTALS_LEFT)}>
      <button type="button" onClick={onOpen} aria-label="Show their CL, CH and weekly-off figures" title="Show the figures" className="no-tap flex w-full flex-col items-center px-1 py-1 hover:bg-slate-50 active:bg-slate-100">
        <span className={cx("block", cl > data.settings.clPerYear ? "font-semibold text-urgent-ink" : "text-slate-700")}>CL {String(cl).padStart(2, "0")}</span>
        <span className={cx("block", limit != null && ch > limit ? "font-semibold text-urgent-ink" : "text-slate-700")}>
          CH {String(ch).padStart(2, "0")}
          {open.length > 0 && <span className={cx("ml-0.5 text-caption2 font-semibold", soon ? "text-urgent-ink" : "text-info-ink")}>+{open.length}</span>}
        </span>
        {w && <span className={cx("block text-caption2", w.offsDue < 0 ? "font-semibold text-urgent-ink" : w.offsDue > 0 ? "font-medium text-low-ink" : "text-slate-500")}>Off {w.offsDue}</span>}
      </button>
    </td>
  );
}

// One line of a person's figures, for the phones' day view and the details: "CL 3 of 20 · CH 1, 2 to take · 1 off due
// · 5 days in a row".
function figuresLine(id: string, data: AttendanceMonth, lookups: Lookups) {
  const t = data.totals.find((x) => x.employeeId === id) ?? { cl: 0, ch: 0 };
  const open = lookups.open.get(id) ?? [];
  const w = lookups.weekly.get(id);
  const limit = lookups.limit.get(id);
  return [
    `CL ${t.cl} of ${data.settings.clPerYear}`,
    `CH ${t.ch}${limit == null ? "" : ` of ${limit}`}${open.length ? `, ${open.length} to take` : ""}`,
    w && `${w.offsDue} ${Math.abs(w.offsDue) === 1 ? "off" : "offs"} due`,
    w && `${w.run} ${w.run === 1 ? "day" : "days"} in a row`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// A person's figures this year (tap the CL / CH cell): CL and CH taken with the limits, each holiday worked whose CH
// is still to take and its last day, and for weekly-off staff the offs due, the days towards the next and the run.
function DetailsDialog({ id, data, lookups, onClose }: { id: string | null; data: AttendanceMonth; lookups: Lookups; onClose: () => void }) {
  const e = data.employees.find((x) => x.id === id);
  const t = data.totals.find((x) => x.employeeId === id) ?? { cl: 0, ch: 0 };
  const open = (id && lookups.open.get(id)) || [];
  const w = id ? lookups.weekly.get(id) : undefined;
  const limit = id ? lookups.limit.get(id) : null;
  const row = (label: string, value: string, bad?: boolean) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={cx("text-right tabular-nums", bad ? "font-semibold text-urgent-ink" : "text-ink")}>{value}</span>
    </div>
  );
  return (
    <Modal open={!!e} onClose={onClose} title={e?.name ?? "Figures"} closeOnBackdrop>
      {e && (
        <div className="divide-y divide-line">
          {row(`Casual leave in ${data.month.slice(0, 4)}`, `${t.cl} of ${data.settings.clPerYear}`, t.cl > data.settings.clPerYear)}
          {row(`Compensation leave in ${data.month.slice(0, 4)}`, `${t.ch}${limit == null ? " (no limit for this post)" : ` of ${limit}`}`, limit != null && t.ch > limit)}
          <div className="py-1.5 text-sm">
            <span className="text-slate-600">Holidays worked, CH to take</span>
            {open.length === 0 ? (
              <p className="text-ink">None</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {open.map((o) => (
                  <li key={o.holiday} className={cx("[overflow-wrap:anywhere]", o.expires <= addDays(data.today, 7) ? "font-medium text-urgent-ink" : "text-ink")}>
                    {o.name}, {dayLabel(o.holiday)}: take by {dayLabel(o.expires)}
                  </li>
                ))}
              </ul>
            )}
            {open.length > CH_HOLD_MAX && <p className="mt-1 text-footnote text-urgent-ink">More than {CH_HOLD_MAX} held; at most {CH_HOLD_MAX} may be.</p>}
          </div>
          {w && (
            <>
              {row("Offs due", String(w.offsDue), w.offsDue < 0)}
              {row("Days towards the next off", `${w.towards} of ${data.settings.offEvery}`)}
              {row("Days in a row so far", `${w.run} (at most ${data.settings.maxRun})`, w.run > data.settings.maxRun)}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// A weekly-off person's days of the month as the counting sees them (weeklyOff), with some cells taken as marked.
function monthStates(data: AttendanceMonth, cells: Cells, e: Person, as?: { dates: Set<string>; mark: AttendanceMark }): WeeklyDay[] {
  return data.days.map((d) => {
    const info = cells.info(e, d.date);
    if (info.out) return { date: d.date, state: "skip" as const };
    if (info.leave) return { date: d.date, state: "reset" as const };
    const m = as?.dates.has(d.date) ? as.mark : info.mark;
    const state: WeeklyDay["state"] = m === "off" ? "off" : m === "absent" ? "reset" : m ? "count" : d.holiday ? "count" : "skip";
    return { date: d.date, state };
  });
}

// CH that must be taken within a week (this month's register): "Rajesh Kumar: Gandhi Jayanthi (2 Oct), by 2 Jan".
function ChDueSoon({ data }: { data: AttendanceMonth }) {
  const lookups = useChLookups(data);
  if (!data.today.startsWith(data.month)) return null;
  const soon = data.employees.flatMap((e) => (lookups.open.get(e.id) ?? []).filter((o) => o.expires <= addDays(data.today, 7)).map((o) => ({ e, o })));
  if (!soon.length) return null;
  return (
    <div className="mb-3 rounded-lg border border-urgent-soft bg-urgent-soft px-3 py-2 text-footnote text-urgent-ink">
      <p className="font-semibold">CH to take within a week (3 months from the holiday worked)</p>
      <ul className="mt-0.5">
        {soon.map(({ e, o }) => (
          <li key={`${e.id}${o.holiday}`} className="[overflow-wrap:anywhere]">
            {e.name}: {o.name} ({dayLabel(o.holiday)}), by {dayLabel(o.expires)}
          </li>
        ))}
      </ul>
    </div>
  );
}
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The month's summary (phase 3): each person's days present, holiday duty, CL, CH, offs, absent, leave and days not
// marked yet. In the Summary pop-up (`bare`: no card or heading of its own, never wider than the pop-up) and, on
// paper only, under the register with signature lines. Narrow screens get short headings (explained under the table)
// and names cut to two lines, so the columns fit.
function MonthSummary({ data, bare }: { data: AttendanceMonth; bare?: boolean }) {
  const counts = monthCounts(data);
  const byId = new Map(data.employees.map((e) => [e.id, e]));
  const cols: [keyof Omit<(typeof counts)[number], "employeeId">, string, string][] = [
    ["present", "Present", "P"],
    ["holidayDuty", "Holiday duty", "HD"],
    ["cl", "CL", "CL"],
    ["ch", "CH", "CH"],
    ["off", "Offs", "O"],
    ["absent", "Absent", "A"],
    ["leave", "Leave", "Lv"],
    ["notMarked", "Not marked", "NM"],
  ];
  const table = (
    <>
      <div className={cx(!bare && "scroll-thin overflow-x-auto print:overflow-visible")}>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="font-serif">
              <th className="border border-slate-300 px-2 py-1 text-left font-semibold text-slate-700">Name</th>
              {cols.map(([, label, short]) => (
                <th key={label} title={label} className="border border-slate-300 px-1 py-1 text-center font-semibold whitespace-nowrap text-slate-700 md:px-1.5">
                  <span className="md:hidden print:hidden">{short}</span>
                  <span className="hidden md:inline print:inline">{label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.employeeId}>
                <td className="min-w-28 border border-slate-300 px-2 py-1 text-ink [overflow-wrap:anywhere] md:min-w-40">
                  <span className="line-clamp-2 md:line-clamp-none print:line-clamp-none">{byId.get(c.employeeId)?.name}</span>
                </td>
                {cols.map(([k]) => (
                  <td key={k} className={cx("border border-slate-300 px-1 py-1 text-center tabular-nums sm:px-1.5", k === "notMarked" && c[k] > 0 ? "font-semibold text-urgent-ink" : c[k] ? "text-ink" : "text-slate-400")}>
                    {c[k]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={cx("py-1.5 text-caption2 text-slate-500 md:hidden print:hidden", !bare && "px-3")}>
        {cols.map(([, label, short]) => (short === label ? null : `${short} ${label.toLowerCase()}`)).filter(Boolean).join(" · ")}
      </p>
    </>
  );
  if (bare) return table;
  return (
    <Card className="mt-4 overflow-hidden print:mt-2 print:rounded-none print:border-0 print:shadow-none">
      <h2 className="border-b border-line px-4 py-2 font-serif text-subhead font-semibold text-ink">Summary for {monthLabel(data.month)}</h2>
      {table}
      {/* Only on paper: the signatures the register is checked with. */}
      <div className="hidden grid-cols-3 gap-8 px-4 pt-12 pb-2 font-serif text-sm text-ink print:grid">
        <span className="border-t border-slate-400 pt-1 text-center">Prepared by</span>
        <span className="border-t border-slate-400 pt-1 text-center">Verified by</span>
        <span className="border-t border-slate-400 pt-1 text-center">Head of Office</span>
      </div>
    </Card>
  );
}

// The month as a CSV (phase 3), like the page: Sl, name, designation, this year's CL and CH, a column per day
// (✓ as P, O, CL, ½CL, CH, A, the leave's short name, H for a holiday or Sunday off not worked, – not in the office:
// an en dash, since the CSV writer guards a cell starting with "-" as a formula),
// then the month's summary.
async function downloadMonth(data: AttendanceMonth) {
  const marks = new Map(data.marks.map((m) => [key(m.employeeId, m.date), m.mark]));
  const counts = new Map(monthCounts(data).map((c) => [c.employeeId, c]));
  const totals = new Map(data.totals.map((t) => [t.employeeId, t]));
  const letter: Record<AttendanceMark, string> = { present: "P", off: "O", cl: "CL", cl_half: "½CL", ch: "CH", absent: "A" };
  const head = ["Sl", "Name", "Designation", "CL this year", "CH this year", ...data.days.map((d) => d.date.slice(8)), "Present", "Holiday duty", "CL", "CH", "Offs", "Absent", "Leave", "Not marked"];
  const rows = data.employees.map((e, i) => {
    const c = counts.get(e.id)!;
    const t = totals.get(e.id) ?? { cl: 0, ch: 0 };
    const cellsOf = data.days.map((d) => {
      if ((e.from && d.date < e.from) || (e.until && d.date > e.until)) return "–";
      const leave = data.leaves.find((l) => l.employeeId === e.id && l.from <= d.date && d.date <= l.to);
      if (leave) return leave.short;
      const m = marks.get(key(e.id, d.date));
      if (m) return letter[m];
      return offByItself(d.date, d.holiday, e.offDay) ? "H" : "";
    });
    return [String(i + 1), e.name, e.designation ?? "", String(t.cl), String(t.ch), ...cellsOf, String(c.present), String(c.holidayDuty), String(c.cl), String(c.ch), String(c.off), String(c.absent), String(c.leave), String(c.notMarked)];
  });
  // toCsv starts with the BOM Excel needs for Malayalam.
  await saveFile(new Blob([toCsv([head, ...rows])], { type: "text/csv;charset=utf-8" }), `attendance-${data.month}.csv`);
}

// The employee's page (phase 3): one line with their month so far, opening the register.
export function AttendanceLine({ employeeId, today }: { employeeId: string; today: string }) {
  const { data } = useAttendance(today.slice(0, 7));
  if (!data || !data.employees.some((e) => e.id === employeeId)) return null;
  const c = monthCounts(data).find((x) => x.employeeId === employeeId)!;
  const w = data.weekly.find((x) => x.employeeId === employeeId);
  const text = [
    `${c.present + c.holidayDuty} present`,
    c.cl && `CL ${c.cl}`,
    c.ch && `CH ${c.ch}`,
    c.off && `${c.off} ${c.off === 1 ? "off" : "offs"}`,
    c.absent && `${c.absent} absent`,
    c.notMarked && `${c.notMarked} not marked`,
    w && `${w.offsDue} off due`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card className="overflow-hidden">
      <Link to="/attendance" className="group/title flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 active:bg-slate-100 sm:px-5">
        <ClipboardCheck size={15} className="shrink-0 text-brand-700" />
        <span className="shrink-0 text-footnote font-semibold text-slate-600 group-hover/title:text-brand-700">Attendance in {monthLabel(data.month).split(" ")[0]}</span>
        <span className="min-w-0 flex-1 truncate text-footnote text-slate-600">{text}</span>
        <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden />
      </Link>
    </Card>
  );
}

// The page of the register (768px and wider). A fixed table layout: the name and CL / CH columns have set widths
// that grow with the screen and the day columns share the rest, so the month fits the page; below about 820px of
// room (46rem) it scrolls sideways with the name and CL / CH columns kept in place. Marks are a size smaller while the
// day columns are narrow (under 1280px), so ½CL fits.
function Register({ data, cells, selected, setSelected }: SelectProps) {
  const office = useOfficeProfile().data?.profile.officeName;
  const anchor = useRef<{ row: number; col: number } | null>(null);
  const drag = useRef<{ add: boolean } | null>(null);
  const settings = data.settings;
  const totals = new Map(data.totals.map((t) => [t.employeeId, t]));
  const ch = useChLookups(data);
  const [details, setDetails] = useState<string | null>(null);
  useEffect(() => {
    const end = () => (drag.current = null);
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  const toggleMany = (keys: string[]) => {
    const all = keys.length > 0 && keys.every((k) => selected.has(k));
    const next = new Set(selected);
    for (const k of keys) all ? next.delete(k) : next.add(k);
    setSelected(next);
  };
  const column = (date: string) => toggleMany(data.employees.filter((e) => cells.selectable(e, date)).map((e) => key(e.id, date)));
  const row = (e: Person) => toggleMany(data.days.filter((d) => cells.selectable(e, d.date)).map((d) => key(e.id, d.date)));
  const cellDown = (ev: ReactPointerEvent, r: number, c: number) => {
    const e = data.employees[r]!;
    const date = data.days[c]!.date;
    const k = key(e.id, date);
    const next = new Set(selected);
    if (ev.shiftKey && anchor.current) {
      const [r0, r1] = [Math.min(anchor.current.row, r), Math.max(anchor.current.row, r)];
      const [c0, c1] = [Math.min(anchor.current.col, c), Math.max(anchor.current.col, c)];
      for (let i = r0; i <= r1; i++) for (let j = c0; j <= c1; j++) if (cells.selectable(data.employees[i]!, data.days[j]!.date)) next.add(key(data.employees[i]!.id, data.days[j]!.date));
    } else {
      const add = !selected.has(k);
      add ? next.add(k) : next.delete(k);
      anchor.current = { row: r, col: c };
      // Mouse: dragging over more cells selects (or unselects) them too.
      if (ev.pointerType === "mouse") drag.current = { add };
    }
    setSelected(next);
  };
  const cellEnter = (r: number, c: number) => {
    if (!drag.current) return;
    const e = data.employees[r]!;
    const date = data.days[c]!.date;
    if (!cells.selectable(e, date)) return;
    const k = key(e.id, date);
    if (selected.has(k) === drag.current.add) return;
    const next = new Set(selected);
    drag.current.add ? next.add(k) : next.delete(k);
    setSelected(next);
  };

  return (
    <Card className="print-register overflow-hidden print:rounded-none print:border-0 print:shadow-none">
      {/* The register's heading. */}
      <div className="border-b-4 border-double border-slate-300 px-4 py-3 text-center">
        <p className="font-serif text-title3 font-bold tracking-[0.2em] text-ink uppercase">Attendance Register</p>
        {office && <p className="font-serif text-subhead text-slate-700 [overflow-wrap:anywhere]">{office}</p>}
        <p className="font-serif text-subhead text-slate-600">For the month of {monthLabel(data.month)}</p>
      </div>
      <div className="scroll-thin overflow-x-auto select-none print:overflow-visible">
        <table className="w-full min-w-[46rem] table-fixed border-collapse text-xs print:min-w-0">
          <colgroup>
            <col className={NAME_COL} />
            <col className={TOTALS_COL} />
            {data.days.map((d) => (
              <col key={d.date} />
            ))}
          </colgroup>
          <thead>
            <tr className="font-serif">
              <th className="sticky left-0 z-20 border border-slate-300 bg-white px-2 py-1.5 text-left font-semibold text-slate-700">Sl · Name</th>
              <th className={cx("sticky z-20 border border-slate-300 bg-white px-1 py-1.5 text-center font-semibold text-slate-700", TOTALS_LEFT)}>CL / CH</th>
              {data.days.map((d) => {
                const pending = d.date <= data.today && data.employees.some((e) => cells.unmarked(e, d.date));
                const keys = data.employees.filter((e) => cells.selectable(e, d.date)).map((e) => key(e.id, d.date));
                const whole = keys.length > 0 && keys.every((k) => selected.has(k));
                return (
                  <th key={d.date} className={cx("border border-slate-300 p-0 font-normal", d.holiday && "bg-slate-100")}>
                    <button
                      type="button"
                      onClick={() => column(d.date)}
                      aria-pressed={whole}
                      aria-label={`${dayLabel(d.date)}${d.holiday ? `, ${d.holiday.name}` : ""}: select everyone`}
                      title={d.holiday ? d.holiday.name : `Select everyone on ${dayLabel(d.date)}`}
                      className={cx(
                        "no-tap flex h-11 w-full flex-col items-center justify-center leading-tight hover:bg-slate-50 aria-pressed:bg-brand-100",
                        d.date === data.today && "ring-2 ring-brand-500 ring-inset",
                      )}
                    >
                      <span className="text-caption2 font-semibold text-ink tabular-nums xl:text-xs">{d.date.slice(8)}</span>
                      <span className={cx("text-caption2", d.weekday === 0 || d.holiday ? "text-urgent-ink" : "text-slate-500")}>{d.holiday ? "H" : WEEKDAY_LETTER[d.weekday]}</span>
                      {pending && <span className="size-1 rounded-full bg-urgent" aria-hidden />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e, r) => {
              const t = totals.get(e.id) ?? { cl: 0, ch: 0 };
              const tds = [];
              for (let c = 0; c < data.days.length; c++) {
                const d = data.days[c]!;
                const info = cells.info(e, d.date);
                if (info.out) {
                  tds.push(
                    <td key={d.date} className="border border-slate-300 bg-slate-50 text-center text-slate-300" title="Not in the office">
                      –
                    </td>,
                  );
                  continue;
                }
                // Leave from the Leave page: one cell across its days in this month, read-only.
                if (info.leave) {
                  let span = 1;
                  while (c + span < data.days.length && data.days[c + span]!.date <= info.leave.to) span++;
                  tds.push(
                    <td key={d.date} colSpan={span} className="border border-slate-300 bg-brand-50 px-0.5 text-center" title={`${info.leave.name}, ${dayLabel(info.leave.from)} to ${dayLabel(info.leave.to)} (Leave page)`}>
                      <Link to={`/leave?employee=${e.id}`} className="no-tap block truncate text-caption2 font-semibold text-brand-700 hover:underline">
                        {info.leave.short}
                      </Link>
                    </td>,
                  );
                  c += span - 1;
                  continue;
                }
                const k = key(e.id, d.date);
                const on = selected.has(k);
                // Holiday duty: present on a holiday of the register (not a Sunday), which earns a CH.
                const duty = info.mark === "present" && !!d.holiday;
                const dutyOpen = duty && ch.open.get(e.id)?.find((o) => o.holiday === d.date);
                const title = info.mark === "ch" && ch.forCell.get(k)
                  ? `CH for the holiday worked on ${dayLabel(ch.forCell.get(k)!)}`
                  : duty
                    ? `Holiday duty (${d.holiday!.name}): ${dutyOpen ? `CH to take by ${dayLabel(dutyOpen.expires)}` : ch.taken.has(k) ? "CH taken" : "CH no longer open"}`
                    : info.mark
                      ? MARK_NAME[info.mark]
                      : d.holiday?.name;
                tds.push(
                  <td key={d.date} className={cx("border border-slate-300 p-0", info.holiday && "bg-slate-100", ch.long.has(k) && "outline outline-1 -outline-offset-1 outline-urgent")}>
                    <button
                      type="button"
                      onPointerDown={(ev) => cellDown(ev, r, c)}
                      onPointerEnter={() => cellEnter(r, c)}
                      aria-pressed={on}
                      aria-label={`${e.name}, ${dayLabel(d.date)}: ${info.mark ? MARK_NAME[info.mark] : info.holiday ? "holiday" : "not marked"}`}
                      title={ch.long.has(k) ? `${title ?? ""} · more than 12 days in a row without an off` : title}
                      className={cx("no-tap relative flex h-8 w-full items-center justify-center overflow-hidden text-caption2 xl:text-xs", on ? "bg-brand-100 outline-2 -outline-offset-2 outline-brand-500" : "hover:bg-slate-50")}
                    >
                      {info.mark && <span className={MARK_TONE[info.mark]}>{MARK_SHORT[info.mark]}</span>}
                      {duty && <span className={cx("absolute top-0.5 right-0.5 size-1.5 rounded-full", dutyOpen ? "bg-info" : "bg-slate-300")} aria-hidden />}
                    </button>
                  </td>,
                );
              }
              return (
                <tr key={e.id}>
                  <th scope="row" className="sticky left-0 z-10 border border-slate-300 bg-white p-0 text-left font-normal">
                    <button type="button" onClick={() => row(e)} title={`Select ${e.name}'s month`} className="no-tap flex w-full items-start gap-1.5 px-2 py-1 text-left hover:bg-slate-50">
                      <span className="w-5 shrink-0 pt-px text-slate-400 tabular-nums">{r + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs font-medium text-ink [overflow-wrap:anywhere]">{e.name}</span>
                        <span className="block truncate text-caption2 text-slate-500">
                          {[e.designation, !e.permanent && "Temporary", e.offDay === "weekly" && OFF_DAY_LABELS.weekly].filter(Boolean).join(" · ")}
                        </span>
                        {ch.weekly.get(e.id) && (
                          <span className={cx("block text-caption2", (ch.weekly.get(e.id)!.long.length ?? 0) > 0 ? "font-medium text-urgent-ink" : "text-slate-500")}>
                            {ch.weekly.get(e.id)!.offsDue} off due · {ch.weekly.get(e.id)!.run} in a row
                            {ch.weekly.get(e.id)!.long.length > 0 && ` · over ${data.settings.maxRun} this month`}
                          </span>
                        )}
                      </span>
                    </button>
                  </th>
                  <TotalsCell id={e.id} cl={t.cl} ch={t.ch} data={data} lookups={ch} onOpen={() => setDetails(e.id)} />
                  {tds}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-footnote text-slate-500">
        ✓ Present · O Weekly off · CL Casual leave · ½CL Half day · CH Compensation leave · A Absent · grey: holiday or Sunday off · a blue dot: holiday worked, CH open (grey once taken) · EL, HPL…: leave from the
        Leave page · a red dot under a day: someone not marked yet · red outline: more than 12 days in a row without an off. CL and CH are this year's; +n: CH still to take.
      </p>
      <DetailsDialog id={details} data={data} lookups={ch} onClose={() => setDetails(null)} />
    </Card>
  );
}

// Phones: one day at a time, everyone listed with their mark.
function DayView({ data, cells, selected, setSelected, onMonth }: SelectProps & { onMonth: (m: string) => void }) {
  const inMonth = data.today.startsWith(data.month);
  const [date, setDate] = useState(inMonth ? data.today : data.days[0]!.date);
  useEffect(() => setDate(inMonth ? data.today : data.days[0]!.date), [data.month, data.today, inMonth]);
  const i = Math.max(0, data.days.findIndex((d) => d.date === date));
  const day = data.days[i]!;
  const go = (n: number) => {
    const j = i + n;
    if (j < 0) onMonth(shiftMonth(data.month, -1));
    else if (j >= data.days.length) onMonth(shiftMonth(data.month, 1));
    else setDate(data.days[j]!.date);
    setSelected(new Set());
  };
  const people = data.employees.filter((e) => !cells.info(e, day.date).out);
  const lookups = useChLookups(data);
  const keys = people.filter((e) => cells.selectable(e, day.date)).map((e) => key(e.id, day.date));
  const all = keys.length > 0 && keys.every((k) => selected.has(k));
  const toggle = (k: string) => {
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    setSelected(next);
  };
  return (
    <Card className="fab-page overflow-hidden">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <button type="button" onClick={() => go(-1)} aria-label="Previous day" className="rounded-lg p-2 text-slate-500 active:scale-90">
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-0 flex-1 text-center">
          <span className="block font-medium text-ink">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span>
          {day.holiday && <span className="block text-footnote text-urgent-ink">{day.holiday.name}</span>}
        </span>
        <button type="button" onClick={() => go(1)} aria-label="Next day" className="rounded-lg p-2 text-slate-500 active:scale-90">
          <ChevronRight size={18} />
        </button>
      </div>
      <button type="button" onClick={() => setSelected(all ? new Set() : new Set(keys))} aria-pressed={all} className="flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left text-sm font-medium text-brand-700">
        <Tick on={all} />
        {all ? "Unselect everyone" : "Select everyone"}
      </button>
      <ul className="divide-y divide-line">
        {people.map((e) => {
          const info = cells.info(e, day.date) as Exclude<CellInfo, { out: true }>;
          const k = key(e.id, day.date);
          return (
            <li key={e.id}>
              <button type="button" disabled={!!info.leave} onClick={() => toggle(k)} aria-pressed={selected.has(k)} className={cx("flex w-full items-center gap-3 px-3 py-2 text-left", info.holiday && "bg-slate-50")}>
                {info.leave ? <span className="size-6 shrink-0" /> : <Tick on={selected.has(k)} />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink [overflow-wrap:anywhere]">{e.name}</span>
                  <span className="block truncate text-footnote text-slate-500">{[e.designation, e.offDay === "weekly" && OFF_DAY_LABELS.weekly].filter(Boolean).join(" · ")}</span>
                  {/* Their figures, since phones have no CL / CH column (attendance phase 2). */}
                  <span className={cx("block text-caption [overflow-wrap:anywhere]", (lookups.weekly.get(e.id)?.long.length ?? 0) > 0 ? "text-urgent-ink" : "text-slate-500")}>{figuresLine(e.id, data, lookups)}</span>
                </span>
                <span className="shrink-0 text-sm">
                  {info.leave ? (
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-footnote font-semibold text-brand-700">{info.leave.short}</span>
                  ) : info.mark ? (
                    <span className={MARK_TONE[info.mark]}>{MARK_SHORT[info.mark]}</span>
                  ) : info.holiday ? (
                    <span className="text-footnote text-slate-400">Holiday</span>
                  ) : (
                    <span className="text-footnote text-slate-400">Not marked</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// The look of a tick circle inside a row's own button (a button can't hold another).
function Tick({ on }: { on: boolean }) {
  return (
    <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-transparent")} aria-hidden>
      <Check size={13} strokeWidth={3} />
    </span>
  );
}

// The bar at the bottom while cells are selected: the marks, Clear, and what would go past the year's CL.
function ActionBar({ data, cells, selected, onDone }: { data: AttendanceMonth; cells: Cells; selected: Set<string>; onDone: () => void }) {
  const { mark, clear } = useAttendanceActions();
  const [replace, setReplace] = useState(false);
  const [picking, setPicking] = useState(false);
  const lookups = useChLookups(data);
  const picked = [...selected].map(unkey);
  const byId = new Map(data.employees.map((e) => [e.id, e]));
  const existing = picked.filter((c) => cells.marks.has(key(c.employeeId, c.date)));
  const weekly = picked.some((c) => byId.get(c.employeeId)?.offDay === "weekly");
  const totals = new Map(data.totals.map((t) => [t.employeeId, t.cl]));
  // CL past the year's days if the selection were marked CL (cells already CL don't count twice).
  const over = [...new Set(picked.map((c) => c.employeeId))]
    .map((id) => {
      const add = picked.filter((c) => c.employeeId === id && !cells.holiday(byId.get(id)!, c.date)).reduce((n, c) => n + 1 - clDays(cells.marks.get(key(id, c.date))), 0);
      return { id, after: (totals.get(id) ?? 0) + add };
    })
    .filter((x) => x.after > data.settings.clPerYear);
  const people = [...new Set(picked.map((c) => c.employeeId))];
  // Offs being marked past the offs earned (weekly-off staff).
  const offsShort = people
    .filter((id) => byId.get(id)?.offDay === "weekly")
    .map((id) => ({ id, due: lookups.weekly.get(id)?.offsDue ?? 0, n: picked.filter((c) => c.employeeId === id && cells.marks.get(key(id, c.date)) !== "off" && !cells.holiday(byId.get(id)!, c.date)).length }))
    .filter((x) => x.n > x.due);
  // CL / CH with the holidays around them past 15 days in a row (KSR Appendix VII), if the selection were CL or CH.
  const longAway = people
    .map((id) => {
      const e = byId.get(id)!;
      const extra = new Set(picked.filter((c) => c.employeeId === id).map((c) => c.date));
      const edge = lookups.edges.get(id) ?? { before: 0, after: 0 };
      let best = 0;
      // The days just before the month carry into its first run, and those just after it end its last one.
      let len = edge.before;
      let touches = false;
      for (const d of data.days) {
        const away = extra.has(d.date) || awayDay(cells.marks.get(key(id, d.date)), cells.holiday(e, d.date));
        if (away) {
          len++;
          touches ||= extra.has(d.date);
          if (touches) best = Math.max(best, len);
        } else {
          len = 0;
          touches = false;
        }
      }
      if (touches && len > 0) best = Math.max(best, len + edge.after);
      return { id, days: best };
    })
    .filter((x) => x.days > CL_RUN_MAX);
  // Weekly-off staff: the days in a row that marking the cells as worked (present, CL or CH) would make, past the
  // most allowed.
  const overRun = people
    .filter((id) => byId.get(id)?.offDay === "weekly")
    .map((id) => {
      const e = byId.get(id)!;
      const w = lookups.weekly.get(id);
      const figures = { offEvery: data.settings.offEvery, maxRun: data.settings.maxRun };
      const before = new Set(weeklyOff(monthStates(data, cells, e), undefined, figures, w?.runBefore ?? 0).long);
      const after = weeklyOff(monthStates(data, cells, e, { dates: new Set(picked.filter((c) => c.employeeId === id).map((c) => c.date)), mark: "present" }), undefined, figures, w?.runBefore ?? 0).long;
      const added = after.filter((d) => !before.has(d));
      return { id, first: added[0] };
    })
    .filter((x) => x.first);
  const run = (m: Markable) =>
    mark.mutate(
      { cells: picked, mark: m, replace },
      {
        onSuccess: (r) => {
          const left = Object.entries(r.skipped);
          showUndo({ message: `${MARK_NAME[m]}: ${r.marked} marked${left.length ? `; left out: ${left.map(([why, n]) => `${why} ${n}`).join(", ")}` : ""}` });
          onDone();
        },
      },
    );
  const busy = mark.isPending || clear.isPending;
  return (
    // Phones: pinned just above the tab bar (the list gets room for it below); wider screens: stuck to the bottom
    // of the page area.
    <div className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.5rem)] z-30 rounded-xl border border-line bg-white p-2.5 shadow-lg md:sticky md:inset-x-auto md:bottom-3 md:mt-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-medium text-ink">{selected.size} selected</span>
        <Button size="sm" variant="primary" onClick={() => run("present")} disabled={busy}>
          <Check size={15} /> Present
        </Button>
        {weekly && (
          <Button size="sm" onClick={() => run("off")} disabled={busy}>
            Off
          </Button>
        )}
        <Button size="sm" onClick={() => run("cl")} disabled={busy}>
          <CalendarClock size={15} /> CL
        </Button>
        <Button size="sm" onClick={() => run("cl_half")} disabled={busy}>
          ½CL
        </Button>
        <Button size="sm" onClick={() => setPicking(true)} disabled={busy}>
          CH
        </Button>
        <Button size="sm" onClick={() => run("absent")} disabled={busy}>
          Absent
        </Button>
        {existing.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => clear.mutate(existing, { onSuccess: (r) => (showUndo({ message: `${r.cleared} marks cleared` }), onDone()) })} disabled={busy}>
            <Eraser size={15} /> Clear
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDone} className="ml-auto" aria-label="Unselect all">
          <X size={15} />
        </Button>
      </div>
      {existing.length > 0 && (
        <label className="mt-1 flex min-h-9 cursor-pointer items-center gap-2 px-1 text-footnote text-slate-600">
          <input type="checkbox" className="size-4 accent-brand-700" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace the {existing.length} {existing.length === 1 ? "mark" : "marks"} already there (otherwise only empty cells change)
        </label>
      )}
      {over.length > 0 && (
        <p className="mt-1 px-1 text-footnote text-urgent-ink [overflow-wrap:anywhere]">
          As CL: {over.map((x) => `${byId.get(x.id)?.name} ${x.after} of ${data.settings.clPerYear}`).join(", ")} this year (casual leave, KSR Appendix VII). It can still be marked.
        </p>
      )}
      {offsShort.length > 0 && (
        <p className="mt-1 px-1 text-footnote text-urgent-ink [overflow-wrap:anywhere]">
          As offs: {offsShort.map((x) => `${byId.get(x.id)?.name} has ${x.due} due, ${x.n} marked`).join(", ")} (an off is earned by 6 days of work).
        </p>
      )}
      {overRun.length > 0 && (
        <p className="mt-1 px-1 text-footnote text-urgent-ink [overflow-wrap:anywhere]">
          As Present, CL or CH: {overRun.map((x) => `${byId.get(x.id)?.name} past ${data.settings.maxRun} days in a row on ${dayLabel(x.first!)}`).join(", ")}; an off is due first.
        </p>
      )}
      {longAway.length > 0 && (
        <p className="mt-1 px-1 text-footnote text-urgent-ink [overflow-wrap:anywhere]">
          As CL or CH, with the holidays around it: {longAway.map((x) => `${byId.get(x.id)?.name} ${x.days} days in a row`).join(", ")}; at most 15 (KSR Appendix VII).
        </p>
      )}
      <ErrorNote error={mark.error ?? clear.error} />
      {picking && <ChPicker data={data} cells={cells} lookups={lookups} picked={picked} replace={replace} onClose={() => setPicking(false)} onDone={onDone} />}
    </div>
  );
}

// Mark CH (phase 2): for each person, each chosen day with the holiday worked it is for, from their holidays whose
// CH is still open on that day (the oldest first; one holiday a CH). Days with none are left out.
function ChPicker({ data, cells, lookups, picked, replace, onClose, onDone }: { data: AttendanceMonth; cells: Cells; lookups: Lookups; picked: AttendanceCell[]; replace: boolean; onClose: () => void; onDone: () => void }) {
  const { markCh } = useAttendanceActions();
  const byId = new Map(data.employees.map((e) => [e.id, e]));
  const rows = useMemo(() => {
    const out: { employeeId: string; dates: string[] }[] = [];
    for (const c of [...picked].sort((a, b) => a.date.localeCompare(b.date))) {
      const e = byId.get(c.employeeId);
      if (!e || cells.holiday(e, c.date) || cells.marks.get(key(c.employeeId, c.date)) === "ch") continue;
      const row = out.find((r) => r.employeeId === c.employeeId);
      row ? row.dates.push(c.date) : out.push({ employeeId: c.employeeId, dates: [c.date] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);
  // Every open holiday of theirs, the expired ones too (for the "past 3 months" note).
  const openOf = (id: string) => data.chOpen.filter((o) => o.employeeId === id);
  // The oldest holiday that fits each day, each used once.
  const [choice, setChoice] = useState<Record<string, string>>(() => {
    const c: Record<string, string> = {};
    for (const r of rows) {
      const used = new Set<string>();
      for (const d of r.dates) {
        const o = openOf(r.employeeId).find((x) => chFits(x, d) && !used.has(x.holiday));
        if (o) {
          c[key(r.employeeId, d)] = o.holiday;
          used.add(o.holiday);
        }
      }
    }
    return c;
  });
  const items = Object.entries(choice)
    .filter(([, h]) => h)
    .map(([k, holiday]) => ({ ...unkey(k), holiday }));
  const submit = () =>
    markCh.mutate(
      { items, replace },
      {
        onSuccess: (r) => {
          const left = Object.entries(r.skipped);
          showUndo({ message: `CH: ${r.marked} marked${left.length ? `; left out: ${left.map(([why, n]) => `${why} ${n}`).join(", ")}` : ""}` });
          onClose();
          onDone();
        },
      },
    );
  return (
    <Modal open onClose={onClose} title="Compensation leave">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Each CH is for a holiday the person worked, taken within 3 months of it (G.O.(Ms) 43/2021/H&FWD). Choose the holiday for each day.</p>
        {rows.length === 0 && <p className="text-sm text-slate-500">Nothing to mark: the days chosen are holidays or CH already.</p>}
        {rows.map((r) => {
          const e = byId.get(r.employeeId)!;
          const open = openOf(r.employeeId);
          const total = data.totals.find((t) => t.employeeId === r.employeeId)?.ch ?? 0;
          const limit = lookups.limit.get(r.employeeId);
          const adding = r.dates.filter((d) => choice[key(r.employeeId, d)]).length;
          const held = open.filter((o) => o.expires >= data.today).length;
          return (
            <div key={r.employeeId} className="rounded-lg border border-line p-3">
              <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{e.name}</p>
              {open.length === 0 ? (
                <p className="mt-1 text-footnote text-slate-500">No holiday worked to take CH for.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {r.dates.map((d) => {
                    const k = key(r.employeeId, d);
                    const fits = open.filter((o) => chFits(o, d) && (choice[k] === o.holiday || !Object.entries(choice).some(([kk, h]) => kk !== k && kk.startsWith(`${r.employeeId}|`) && h === o.holiday)));
                    return (
                      <li key={d} className="grid gap-1 min-[420px]:grid-cols-[7rem_1fr] min-[420px]:items-center">
                        <span className="text-sm text-slate-700">{dayLabel(d)}</span>
                        {fits.length === 0 ? (
                          <span className="text-footnote text-slate-500">No holiday worked before it in the last 3 months</span>
                        ) : (
                          <select className={inputClass} value={choice[k] ?? ""} onChange={(ev) => setChoice((c) => ({ ...c, [k]: ev.target.value }))} aria-label={`Holiday for the CH on ${dayLabel(d)}`}>
                            <option value="">Not CH</option>
                            {fits.map((o) => (
                              <option key={o.holiday} value={o.holiday}>
                                {o.name}, {dayLabel(o.holiday)} (take by {dayLabel(o.expires)})
                              </option>
                            ))}
                          </select>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {limit != null && total + adding > limit && <p className="mt-1 text-footnote text-urgent-ink">CH this year would be {total + adding}; the limit for this post is {limit}.</p>}
              {held > CH_HOLD_MAX && <p className="mt-1 text-footnote text-urgent-ink">{held} CH are waiting to be taken; at most {CH_HOLD_MAX} may be held.</p>}
            </div>
          );
        })}
        <ErrorNote error={markCh.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={items.length === 0 || markCh.isPending}>
            <Check size={15} /> Mark {items.length} CH
          </Button>
        </div>
      </div>
    </Modal>
  );
}
