// Person days (user request 2026-11-02, "when someone says I am off tomorrow and CL on the day after, I should mark
// it"; docs/ATTENDANCE_ASSIST_PLAN.md 3.1, phase 1): one person's three weeks, Monday to Sunday rows (‹ › for other
// weeks), the same on phones (a sheet) and computers. Tap days (several at once), then a mark: Duty, Off (weekly-off
// staff), CL, ½CL, CH… (choose the holiday worked for each day), Absent or Clear; saved at once, future days too
// (drawn lighter until they come), with Undo putting back what was there. Each mark button says before it is tapped
// what it would cause for the days chosen (an off taken early, CL past the year's days, past the most days in a row,
// CL / CH with holidays past 15 days, no holiday worked open for a CH; and G.O.(Ms) 303/82/HSD: no off after a week
// away on CL, CH and offs, not CL, CH and an off all in one week; CL / CH next to leave from the Leave page, KSR
// Appendix VII); nothing is blocked. Weekly-off staff show when the off owed must be taken by (G.O.(Ms) 161/08/AD). Opened with
// openPersonDays(id) from the Today tab's names and the Offs board, or openPersonDays() (the + button / Mark for
// someone), which first asks who. Lives once in the app shell (PersonDaysHost).
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { PersonDay, PersonDays as Data } from "../../shared/types";
import { CL_RUN_MAX, MARK_NAME, MARK_SHORT, awayDay, chFits, clDays, go303Breaks, mondayOf, nextToLeave, notEligible, offStatus, offTakeBy, offsEarned, weeklyOff, type AttendanceMark, type MarkDay, type OffCheckDay, type WeeklyDay } from "../../shared/attendance";
import { dayLabel } from "../../shared/reminderSchedule";
import { OFF_DAY_LABELS } from "../../shared/staff";
import { useAttendanceActions, useMe, usePersonDays, useStaff } from "../api";
import { showUndo } from "./SwipeRow";
import { Button, ErrorNote, Loading, Modal, TONE, cx, inputClass } from "./ui";

let opener: ((id: string | null) => void) | null = null;
export const openPersonDays = (id?: string) => opener?.(id ?? null);

export function PersonDaysHost() {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    opener = (who) => {
      setId(who);
      setPicked(!who);
      setOpen(true);
    };
    return () => {
      opener = null;
    };
  }, []);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={id ? "Mark days" : "Mark for someone"} wide>
      {open && (id ? <PersonDaysView key={id} id={id} onChangePerson={picked ? () => setId(null) : undefined} /> : <WhoPicker onPick={setId} />)}
    </Modal>
  );
}

// Who: everyone in the office today, in designation order then name, with a search box.
function WhoPicker({ onPick }: { onPick: (id: string) => void }) {
  const staff = useStaff().data;
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const [q, setQ] = useState("");
  if (!staff) return <Loading />;
  const order = new Map(staff.designations.map((d, i) => [d.id, i]));
  const desig = new Map(staff.designations.map((d) => [d.id, d.name]));
  const people = staff.employees
    .filter((e) => (!e.joinedOfficeOn || e.joinedOfficeOn <= today) && (!e.leftOn || e.leftOn >= today))
    .filter((e) => !q.trim() || `${e.name} ${e.pen ?? ""} ${desig.get(e.designationId ?? "") ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (order.get(a.designationId ?? "") ?? 1e9) - (order.get(b.designationId ?? "") ?? 1e9) || a.name.localeCompare(b.name));
  return (
    <div className="space-y-3">
      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
        <input className={cx(inputClass, "pl-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, PEN or post" aria-label="Find the person" />
      </label>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {people.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onPick(e.id)} className="block w-full px-3 py-2 text-left hover:bg-slate-50 active:bg-slate-100">
              <span className="block text-sm text-ink [overflow-wrap:anywhere]">{e.name}</span>
              <span className="block truncate text-footnote text-slate-500">{[desig.get(e.designationId ?? ""), e.offDay === "weekly" && OFF_DAY_LABELS.weekly].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
        {people.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Nobody matches.</li>}
      </ul>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const short = (d: string) => `${DAY_NAMES[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
type Markable = Exclude<AttendanceMark, "ch">;
const TONE_OF = { red: "urgent", orange: "high", amber: "medium", blue: "info", grey: "neutral" } as const;
const MARK_LOOK: Record<AttendanceMark, string> = {
  present: "text-low-ink",
  off: "text-brand-700",
  cl: "text-high-ink",
  cl_half: "text-high-ink",
  ch: "text-info-ink",
  absent: "text-urgent-ink",
};

function PersonDaysView({ id, onChangePerson }: { id: string; onChangePerson?: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => mondayOf(today));
  const { data, error } = usePersonDays(id, from);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choosingCh, setChoosingCh] = useState(false);
  const { mark, clear, markCh } = useAttendanceActions();
  useEffect(() => setSelected(new Set()), [from]);
  const warn = useMemo(() => (data ? warnings(data, selected) : null), [data, selected]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const e = data.employee;
  const weekly = e.offDay === "weekly";
  const st = data.weekly ? offStatus(data.weekly, data.settings) : null;
  const chosen = data.days.filter((d) => selected.has(d.date));
  const toggle = (d: PersonDay) => {
    if (d.out || d.leave) return;
    const next = new Set(selected);
    next.has(d.date) ? next.delete(d.date) : next.add(d.date);
    setSelected(next);
  };
  const cellsOf = (list: PersonDay[]) => list.map((d) => ({ employeeId: e.id, date: d.date }));
  // Undo puts back what each chosen day had: its mark (a CH with its holiday) or nothing.
  const restore = (was: PersonDay[]) => () => {
    const none = was.filter((d) => !d.mark);
    if (none.length) clear.mutate(cellsOf(none));
    const chs = was.filter((d) => d.mark === "ch" && d.chHoliday);
    if (chs.length) markCh.mutate({ items: chs.map((d) => ({ employeeId: e.id, date: d.date, holiday: d.chHoliday! })), replace: true });
    for (const m of ["present", "off", "cl", "cl_half", "absent"] as Markable[]) {
      const these = was.filter((d) => d.mark === m);
      if (these.length) mark.mutate({ cells: cellsOf(these), mark: m, replace: true });
    }
  };
  const apply = (m: Markable) => {
    const was = chosen.map((d) => ({ ...d }));
    mark.mutate(
      { cells: cellsOf(chosen), mark: m, replace: true },
      {
        onSuccess: (r) => {
          const left = Object.entries(r.skipped);
          showUndo({
            message: `${MARK_NAME[m]}: ${plural(r.marked, "day")} for ${e.name}${left.length ? `; left out: ${left.map(([why, n]) => `${why} ${n}`).join(", ")}` : ""}`,
            onUndo: r.marked ? restore(was) : undefined,
          });
          setSelected(new Set());
        },
      },
    );
  };
  const wipe = () => {
    const was = chosen.filter((d) => d.mark).map((d) => ({ ...d }));
    clear.mutate(cellsOf(was), {
      onSuccess: (r) => {
        showUndo({ message: `${plural(r.cleared, "mark")} cleared for ${e.name}${r.kept ? ` (${r.kept} kept: its CH is taken)` : ""}`, onUndo: r.cleared ? restore(was) : undefined });
        setSelected(new Set());
      },
    });
  };
  const allHoliday = chosen.length > 0 && chosen.every((d) => d.holiday);
  const busy = mark.isPending || clear.isPending || markCh.isPending;
  const button = (m: Markable | "ch" | "clear", label: string) => {
    const w = warn?.[m];
    const disabled = busy || chosen.length === 0 || (m === "clear" ? !chosen.some((d) => d.mark) : allHoliday && m !== "present");
    return (
      <button
        key={m}
        type="button"
        disabled={disabled}
        onClick={() => (m === "clear" ? wipe() : m === "ch" ? setChoosingCh(true) : apply(m))}
        className={cx(
          "flex min-h-11 flex-col items-center justify-center rounded-lg border px-2.5 py-1 text-sm font-medium transition active:scale-[0.97] disabled:opacity-50",
          m === "present" ? "border-brand-600 bg-brand-600 text-white enabled:hover:bg-brand-700" : m === "absent" || m === "clear" ? "border-line bg-white text-urgent-ink enabled:hover:bg-slate-50" : "border-line bg-white text-ink enabled:hover:bg-slate-50",
        )}
      >
        {label}
        {w && !disabled && <span className={cx("text-caption2 leading-tight font-normal", m === "present" ? "text-white/90" : "text-urgent-ink")}>{w}</span>}
      </button>
    );
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-headline font-semibold text-ink [overflow-wrap:anywhere] sm:text-base">{e.name}</p>
          <p className="text-footnote text-slate-500">{[e.designation, weekly ? OFF_DAY_LABELS.weekly : OFF_DAY_LABELS.sunday].filter(Boolean).join(" · ")}</p>
          {onChangePerson && (
            <button type="button" onClick={onChangePerson} className="text-footnote font-medium text-brand-700 hover:underline">
              Someone else
            </button>
          )}
        </div>
        {st && data.weekly?.countFrom && (
          <span className="flex flex-col items-end gap-0.5">
            <span className={cx("rounded-full px-2 py-0.5 text-footnote font-medium whitespace-nowrap", TONE[TONE_OF[st.tone]].soft)}>
              Day {data.weekly.run} · {st.text}
            </span>
            {/* G.O.(Ms) 161/08/AD: take the off within a month of earning it. */}
            {data.weekly.owedSince[0] &&
              (offTakeBy(data.weekly.owedSince[0]) < data.today ? (
                <span className="text-caption font-medium text-urgent-ink">owed since {dayLabel(data.weekly.owedSince[0]).replace(/ \d{4}$/, "")}: over a month</span>
              ) : (
                <span className="text-caption text-slate-500">take by {dayLabel(offTakeBy(data.weekly.owedSince[0])).replace(/ \d{4}$/, "")}</span>
              ))}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setFrom(addDays(from, -7))} aria-label="Earlier week" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-0 flex-1 text-center text-sm font-medium text-ink">
          {dayLabel(data.from).replace(/ \d{4}$/, "")} – {dayLabel(data.to)}
        </span>
        {from !== mondayOf(today) && (
          <Button size="sm" variant="ghost" onClick={() => setFrom(mondayOf(today))}>
            This week
          </Button>
        )}
        <button type="button" onClick={() => setFrom(addDays(from, 7))} aria-label="Later week" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
          <ChevronRight size={18} />
        </button>
      </div>

      <div role="grid" aria-label={`${e.name}'s days`} className="select-none">
        <div role="row" className="grid grid-cols-7 gap-1 pb-1">
          {WEEKDAYS.map((w) => (
            <span key={w} role="columnheader" className="text-center text-caption font-medium text-slate-500">
              {w}
            </span>
          ))}
        </div>
        {[0, 1, 2].map((week) => (
          <div role="row" key={week} className="grid grid-cols-7 gap-1 pb-1">
            {data.days.slice(week * 7, week * 7 + 7).map((d) => (
              <DayCell key={d.date} d={d} today={data.today} on={selected.has(d.date)} onTap={() => toggle(d)} />
            ))}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-slate-50 p-2.5">
        <p className="mb-2 flex flex-wrap items-center gap-x-2 text-footnote text-slate-600">
          {chosen.length === 0 ? (
            "Tap the days, then the mark."
          ) : (
            <>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {plural(chosen.length, "day")}: {chosen.map((d) => short(d.date)).join(", ")}
              </span>
              <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-brand-700 hover:underline">
                Unselect
              </button>
            </>
          )}
        </p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-7">
          {button("present", allHoliday ? "Holiday duty" : "Duty")}
          {weekly && button("off", "Off")}
          {button("cl", "CL")}
          {button("cl_half", "½ CL")}
          {button("ch", "CH…")}
          {button("absent", "Absent")}
          {button("clear", "Clear")}
        </div>
        <ErrorNote error={mark.error ?? clear.error ?? markCh.error} />
      </div>

      {choosingCh && <ChChoose data={data} days={chosen.filter((d) => !d.holiday)} onClose={() => setChoosingCh(false)} onDone={() => (setChoosingCh(false), setSelected(new Set()))} />}

      <p className="text-footnote text-slate-600 [overflow-wrap:anywhere]">
        CL {data.cl} of {data.settings.clPerYear} this year · CH {data.ch}
        {data.chLimit === null ? "" : ` of ${data.chLimit}`}
        {data.chOpen.filter((o) => o.expires >= data.today).length > 0 &&
          `, to take: ${data.chOpen
            .filter((o) => o.expires >= data.today)
            .map((o) => `${o.name} by ${dayLabel(o.expires)}`)
            .join("; ")}`}
        {weekly && ` · Last off ${data.lastOff ? dayLabel(data.lastOff) : "not marked"}`}
      </p>
      <p className="text-caption text-slate-500">Future days are drawn lighter until they come; a dotted O is an off planned on the Offs tab.</p>
    </div>
  );
}

// A day: its number, then its mark (✓, O, CL, ½, CH, A), the leave's short name, H (holiday) or a planned off's dotted
// O. Today outlined; future marks lighter; leave and days outside the office can't be chosen.
function DayCell({ d, today, on, onTap }: { d: PersonDay; today: string; on: boolean; onTap: () => void }) {
  const future = d.date > today;
  const words = d.out ? "not in the office" : d.leave ? `leave (${d.leave})` : d.mark ? MARK_NAME[d.mark] : d.holiday ? d.holiday : d.planned ? "off planned" : "not marked";
  return (
    <button
      type="button"
      role="gridcell"
      disabled={d.out || !!d.leave}
      aria-selected={on}
      aria-label={`${dayLabel(d.date)}: ${words}`}
      title={`${dayLabel(d.date)}: ${words}`}
      onClick={onTap}
      className={cx(
        "no-tap flex h-14 min-w-0 flex-col items-center justify-center rounded-lg border text-center transition active:scale-[0.97] disabled:cursor-default",
        on ? "border-brand-600 bg-brand-100 ring-2 ring-brand-500" : d.holiday ? "border-line bg-slate-100" : d.out ? "border-transparent bg-slate-50" : "border-line bg-white enabled:hover:bg-slate-50",
        d.date === today && !on && "ring-2 ring-brand-400",
      )}
    >
      <span className={cx("text-footnote leading-tight tabular-nums", d.date === today ? "font-bold text-brand-700" : "text-slate-600")}>{Number(d.date.slice(8))}</span>
      <span className={cx("text-footnote leading-tight font-semibold", future && "opacity-55")}>
        {d.leave ? (
          <span className="text-snooze-ink">{d.leave.length <= 3 ? d.leave : "L"}</span>
        ) : d.mark ? (
          <span className={MARK_LOOK[d.mark]}>{d.mark === "cl_half" ? "½" : MARK_SHORT[d.mark]}</span>
        ) : d.planned ? (
          <span className="rounded border border-dashed border-brand-500 px-0.5 text-brand-700">O</span>
        ) : d.holiday ? (
          <span className="font-normal text-slate-400">H</span>
        ) : (
          <span className="text-transparent">·</span>
        )}
      </span>
    </button>
  );
}

// What each mark would cause for the chosen days, said on its button before it is tapped (nothing is blocked).
function warnings(data: Data, selected: Set<string>) {
  const out: Partial<Record<Markable | "ch" | "clear", string>> = {};
  const chosen = data.days.filter((d) => selected.has(d.date) && !d.out && !d.leave);
  const working = chosen.filter((d) => !d.holiday);
  if (!working.length) return out;
  const w = data.weekly;
  // G.O.(Ms) 303/82/HSD: CL, CH and offs together for a week or more count nothing (as the server counts).
  const states = (as?: AttendanceMark): WeeklyDay[] =>
    notEligible(
      statesOf(as),
      data.days.map((d) => {
        if (d.out || d.leave) return { date: d.date, mark: null };
        const m = as && selected.has(d.date) && !d.holiday ? as : d.mark;
        return { date: d.date, mark: m, holiday: !!d.holiday && !m };
      }),
    );
  const statesOf = (as?: AttendanceMark): WeeklyDay[] =>
    data.days.map((d) => {
      if (d.out || (w?.countFrom && d.date < w.countFrom)) return { date: d.date, state: "skip" as const };
      if (d.leave) return { date: d.date, state: "reset" as const };
      const m = as && selected.has(d.date) && !d.holiday ? as : d.mark;
      const state: WeeklyDay["state"] =
        m === "off" ? "off" : m === "absent" ? "reset" : m ? "count" : d.holiday ? "count" : data.settings.assumeDuty && w?.countFrom && d.date < data.today ? "count" : "skip";
      return { date: d.date, state };
    });
  if (w && data.employee.offDay === "weekly") {
    // An off before it is earned.
    const asked: OffCheckDay[] = states().map((s) => (working.some((d) => d.date === s.date) && data.days.find((d) => d.date === s.date)?.mark !== "off" ? { ...s, state: "off", asked: true, was: s.state } : s));
    const early = [...offsEarned(asked, { offsDue: w.dueBefore, towards: w.towardsBefore }, data.settings).refused];
    if (early.length) out.off = early.length === 1 ? `${plural(early[0]![1], "day")} early` : `${early.length} taken early`;
    // Past the most days in a row.
    const before = new Set(weeklyOff(states(), undefined, data.settings, w.runBefore).long);
    for (const m of ["present", "cl", "cl_half"] as Markable[]) {
      const added = weeklyOff(states(m), undefined, data.settings, w.runBefore).long.filter((x) => !before.has(x));
      if (added.length) out[m] = `past ${data.settings.maxRun} days in a row`;
    }
  }
  // CL past the year's days (half days ½; days already CL don't count twice).
  for (const m of ["cl", "cl_half"] as Markable[]) {
    const add = working.reduce((n, d) => n + clDays(m) - clDays(d.mark), 0);
    if (data.cl + add > data.settings.clPerYear) out[m] = `${data.cl + add} of ${data.settings.clPerYear} CL`;
  }
  // CL / CH with the holidays around them past 15 days in a row (KSR Appendix VII).
  for (const m of ["cl", "ch"] as const) {
    let len = data.edges.before;
    let best = 0;
    let touches = false;
    for (const d of data.days) {
      const away = d.out || d.leave ? false : selected.has(d.date) && !d.holiday ? true : awayDay(d.mark, !!d.holiday);
      if (away) {
        len++;
        touches ||= selected.has(d.date);
        if (touches) best = Math.max(best, len);
      } else {
        len = 0;
        touches = false;
      }
    }
    if (touches && len > 0) best = Math.max(best, len + data.edges.after);
    if (best > CL_RUN_MAX) out[m] = `${best} days away in a row`;
  }
  // CH needs a holiday worked open for each day.
  const lacking = working.filter((d) => !data.chOpen.some((o) => chFits(o, d.date)));
  if (lacking.length) out.ch = lacking.length === working.length ? "no holiday worked open" : `none open for ${lacking.length}`;
  // CL and CH not combined with regular leave (KSR Appendix VII rule 6; G.O.(Ms) 43/2021).
  const touching = nextToLeave(
    data.days.map((d) => ({ date: d.date, leave: !!d.leave, holiday: !!d.holiday && !d.mark })),
    new Set(working.map((d) => d.date)),
  );
  if (touching.length)
    for (const m of ["cl", "cl_half", "ch"] as const) out[m] = [out[m], "next to leave"].filter(Boolean).join(" · ");
  // G.O.(Ms) 303/82/HSD: no off after a week away on CL, CH and offs; not CL, CH and an off all in one week.
  const marked: MarkDay[] = data.days.map((d) => ({ date: d.date, mark: d.out || d.leave ? null : d.mark, holiday: !d.out && !d.leave && !d.mark && !!d.holiday }));
  const dates = new Set(working.map((d) => d.date));
  for (const m of ["off", "cl", "cl_half", "ch"] as const) {
    if (m === "off" && data.employee.offDay !== "weekly") continue;
    const b = go303Breaks(marked, dates, m);
    const said = [out[m], b.offInLongAway.length ? "no off after a week away" : null, b.threeInWeek.length ? "CL, CH and off in one week" : null].filter(Boolean);
    if (said.length) out[m] = said.join(" · ");
  }
  return out;
}

// CH for the chosen days: each day gets one of the holidays worked still open on it (oldest first, each once).
function ChChoose({ data, days, onClose, onDone }: { data: Data; days: PersonDay[]; onClose: () => void; onDone: () => void }) {
  const { markCh } = useAttendanceActions();
  const [choice, setChoice] = useState<Record<string, string>>(() => {
    const c: Record<string, string> = {};
    const used = new Set<string>();
    for (const d of days) {
      const o = data.chOpen.find((x) => chFits(x, d.date) && !used.has(x.holiday) && !data.days.some((y) => y.chHoliday === x.holiday));
      if (o) {
        c[d.date] = o.holiday;
        used.add(o.holiday);
      }
    }
    return c;
  });
  const items = Object.entries(choice)
    .filter(([, h]) => h)
    .map(([date, holiday]) => ({ employeeId: data.employee.id, date, holiday }));
  return (
    <Modal open onClose={onClose} title="Compensation leave">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Each CH is for a holiday worked in the last 3 months (G.O.(Ms) 43/2021/H&FWD).</p>
        {days.length === 0 && <p className="text-sm text-slate-500">The days chosen are holidays.</p>}
        <ul className="space-y-2">
          {days.map((d) => {
            const fits = data.chOpen.filter((o) => chFits(o, d.date) && (choice[d.date] === o.holiday || !Object.entries(choice).some(([k, h]) => k !== d.date && h === o.holiday)));
            return (
              <li key={d.date} className="grid gap-1 min-[420px]:grid-cols-[7rem_1fr] min-[420px]:items-center">
                <span className="text-sm text-slate-700">{dayLabel(d.date)}</span>
                {fits.length === 0 ? (
                  <span className="text-footnote text-slate-500">No holiday worked open for this day</span>
                ) : (
                  <select className={inputClass} value={choice[d.date] ?? ""} onChange={(ev) => setChoice((c) => ({ ...c, [d.date]: ev.target.value }))} aria-label={`Holiday for the CH on ${dayLabel(d.date)}`}>
                    <option value="">Not CH</option>
                    {fits.map((o) => (
                      <option key={o.holiday} value={o.holiday}>
                        {o.name}, {dayLabel(o.holiday)} (by {dayLabel(o.expires)})
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
        <ErrorNote error={markCh.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={items.length === 0 || markCh.isPending}
            onClick={() =>
              markCh.mutate(
                { items, replace: true },
                {
                  onSuccess: (r) => {
                    showUndo({ message: `CH: ${plural(r.marked, "day")} for ${data.employee.name}` });
                    onDone();
                  },
                },
              )
            }
          >
            Mark {items.length} CH
          </Button>
        </div>
      </div>
    </Modal>
  );
}
