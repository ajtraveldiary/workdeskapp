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
// someone), which first asks who. Since 2026-11-03 also OD (on duty, as present; a remark asked for first) and H / SS
// (a holiday or second Saturday taken: only on holidays of the register; weekly-off staff count it as duty). Lives once in the app shell (PersonDaysHost).
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { PersonDay, PersonDays as Data } from "../../shared/types";
import { MARK_NAME, chExpires, chFits, inAttendance, markName, markShort, monthLabel, shiftMonth, offStatus, offTakeBy, type AttendanceMark } from "../../shared/attendance";
import { markWarnings } from "../../shared/markWarnings";
import { LEAVE_BAND, MARK_COLOR } from "../markColors";
import { dayLabel, dayShort } from "../../shared/reminderSchedule";
import { OFF_DAY_LABELS } from "../../shared/staff";
import { useAttendanceActions, useAttendanceSettings, useMe, usePersonDays, useStaff } from "../api";
import { showUndo } from "./SwipeRow";
import { HolidayWorkedForm } from "./HolidayWorked";
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
  // Only those in the register (Settings › Attendance › Who is in the register).
  const settings = useAttendanceSettings().data?.settings;
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const [q, setQ] = useState("");
  if (!staff || !settings) return <Loading />;
  const order = new Map(staff.designations.map((d, i) => [d.id, i]));
  const desig = new Map(staff.designations.map((d) => [d.id, d.name]));
  const people = staff.employees
    .filter((e) => (!e.joinedOfficeOn || e.joinedOfficeOn <= today) && (!e.leftOn || e.leftOn >= today) && inAttendance(e, settings))
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
const short = (d: string) => `${DAY_NAMES[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
type Markable = Exclude<AttendanceMark, "ch">;
const TONE_OF = { red: "urgent", orange: "high", amber: "medium", blue: "info", grey: "neutral" } as const;
// One colour per kind of mark, shared with the register and the Mark leave pop-up (markColors.ts, 2026-11-08).
const MARK_LOOK = MARK_COLOR;
// A day's holiday name as markShort / markName read it: "Second Saturday" is the second Saturday.
const holidayKind = (d: PersonDay) => (d.holiday ? { kind: d.holiday === "Second Saturday" ? ("second_saturday" as const) : ("public" as const) } : null);

function PersonDaysView({ id, onChangePerson }: { id: string; onChangePerson?: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  // A month calendar (user request 2026-11-03, replacing three weeks at a time): this month to start.
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const { data, error } = usePersonDays(id, month);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choosingCh, setChoosingCh] = useState(false);
  // OD asks for a remark (where they were on duty) before it is marked.
  const [odOpen, setOdOpen] = useState(false);
  const [odNote, setOdNote] = useState("");
  const { mark, clear, markCh } = useAttendanceActions();
  useEffect(() => setSelected(new Set()), [month]);
  const warn = useMemo(() => (data ? markWarnings(data, selected) : null), [data, selected]);
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
    for (const m of ["present", "off", "cl", "cl_half", "absent", "holiday"] as Markable[]) {
      const these = was.filter((d) => d.mark === m);
      if (these.length) mark.mutate({ cells: cellsOf(these), mark: m, replace: true });
    }
    // An OD goes back with its own remark.
    for (const d of was.filter((x) => x.mark === "od")) mark.mutate({ cells: cellsOf([d]), mark: "od", replace: true, note: d.note });
  };
  const apply = (m: Markable, note = "") => {
    const was = chosen.map((d) => ({ ...d }));
    mark.mutate(
      { cells: cellsOf(chosen), mark: m, replace: true, note },
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
    const w = warn?.[m]?.map((x) => x.short).join(" · ");
    // Every mark can be put on any day (2026-11-09: anything entered is saved; the register outlines a mark that
    // breaks a rule in yellow). The holiday taken (H / SS) is still offered only for holidays of the register.
    const disabled = busy || chosen.length === 0 || (m === "clear" ? !chosen.some((d) => d.mark) : m === "holiday" ? !chosen.every((d) => d.holiday && d.holiday !== "Sunday") : false);
    return (
      <button
        key={m}
        type="button"
        disabled={disabled}
        onClick={() => (m === "clear" ? wipe() : m === "ch" ? setChoosingCh(true) : m === "od" ? setOdOpen(!odOpen) : apply(m))}
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
                <span className="text-caption font-medium text-urgent-ink">owed since {dayShort(data.weekly.owedSince[0])}: over a month</span>
              ) : (
                <span className="text-caption text-slate-500">take by {dayShort(offTakeBy(data.weekly.owedSince[0]))}</span>
              ))}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Earlier month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-0 flex-1 text-center text-sm font-medium text-ink">{monthLabel(month)}</span>
        {month !== today.slice(0, 7) && (
          <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>
            This month
          </Button>
        )}
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Later month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 active:scale-90">
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
        {Array.from({ length: Math.ceil(data.days.length / 7) }, (_, week) => (
          <div role="row" key={week} className="grid grid-cols-7 gap-1 pb-1">
            {data.days.slice(week * 7, week * 7 + 7).map((d) => (
              <DayCell key={d.date} d={d} today={data.today} on={selected.has(d.date)} dim={d.date.slice(0, 7) !== month} onTap={() => toggle(d)} />
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
          {button("off", "Off")}
          {button("cl", "CL")}
          {button("cl_half", "½ CL")}
          {button("ch", "CH…")}
          {button("absent", "Absent")}
          {button("od", "OD")}
          {button("holiday", chosen.length > 0 && chosen.every((d) => d.holiday === "Second Saturday") ? "SS" : "H / SS")}
          {button("clear", "Clear")}
        </div>
        {odOpen && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              apply("od", odNote.trim());
              setOdOpen(false);
              setOdNote("");
            }}
          >
            <input className={cx(inputClass, "min-w-0 flex-1 basis-48")} value={odNote} onChange={(ev) => setOdNote(ev.target.value)} maxLength={200} placeholder="OD remark: where, why (optional)" aria-label="OD remark" />
            <Button type="submit" size="sm" variant="primary" disabled={busy || chosen.length === 0}>
              Mark OD
            </Button>
          </form>
        )}
        <ErrorNote error={mark.error ?? clear.error ?? markCh.error} />
      </div>

      {choosingCh && <ChChoose data={data} days={chosen} onClose={() => setChoosingCh(false)} onDone={() => (setChoosingCh(false), setSelected(new Set()))} />}

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
// `dim`: a day of the month before or after, filling the first and last weeks (faded, still choosable).
function DayCell({ d, today, on, dim, onTap }: { d: PersonDay; today: string; on: boolean; dim?: boolean; onTap: () => void }) {
  const future = d.date > today;
  const words = d.out ? "not in the office" : d.leave ? `leave (${d.leave})` : d.mark ? `${markName(d.mark, holidayKind(d))}${d.note ? `: ${d.note}` : ""}` : d.holiday ? d.holiday : d.planned ? "off planned" : "not marked";
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
        "no-tap flex h-12 min-w-0 flex-col items-center justify-center rounded-lg border text-center transition active:scale-[0.97] disabled:cursor-default sm:h-14",
        dim && !on && "opacity-45",
        on ? "border-brand-600 bg-brand-100 ring-2 ring-brand-500" : d.holiday ? "border-line bg-slate-100" : d.out ? "border-transparent bg-slate-50" : "border-line bg-white enabled:hover:bg-slate-50",
        d.date === today && !on && "ring-2 ring-brand-400",
      )}
    >
      <span className={cx("text-footnote leading-tight tabular-nums", d.date === today ? "font-bold text-brand-700" : "text-slate-600")}>{Number(d.date.slice(8))}</span>
      <span className={cx("text-footnote leading-tight font-semibold", future && "opacity-55")}>
        {d.leave ? (
          <span className={cx("rounded px-0.5", LEAVE_BAND)}>{d.leave.length <= 3 ? d.leave : "L"}</span>
        ) : d.mark ? (
          <span className={MARK_LOOK[d.mark]}>{d.mark === "cl_half" ? "½" : markShort(d.mark, holidayKind(d))}</span>
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

// CH for the chosen days: each day gets one of the holidays worked still open on it (oldest first, each once), or
// since 2026-11-09 none (NO_HOLIDAY: the CH is saved without one and outlined in yellow in the register).
const NO_HOLIDAY = "none";
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
      } else c[d.date] = NO_HOLIDAY;
    }
    return c;
  });
  const items = Object.entries(choice)
    .filter(([, h]) => h)
    .map(([date, holiday]) => ({ employeeId: data.employee.id, date, holiday: holiday === NO_HOLIDAY ? null : holiday }));
  return (
    <Modal open onClose={onClose} title="Compensation leave">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Each CH is for a holiday worked in the last 3 months (G.O.(Ms) 43/2021/H&FWD).</p>
        <ul className="space-y-2">
          {days.map((d) => {
            const fits = data.chOpen.filter((o) => chFits(o, d.date) && (choice[d.date] === o.holiday || !Object.entries(choice).some(([k, h]) => k !== d.date && h === o.holiday)));
            return (
              <li key={d.date} className="grid gap-1 min-[420px]:grid-cols-[7rem_1fr] min-[420px]:items-center">
                <span className="text-sm text-slate-700">{dayLabel(d.date)}</span>
                <select className={inputClass} value={choice[d.date] ?? ""} onChange={(ev) => setChoice((c) => ({ ...c, [d.date]: ev.target.value }))} aria-label={`Holiday for the CH on ${dayLabel(d.date)}`}>
                  <option value="">Not CH</option>
                  <option value={NO_HOLIDAY}>CH without a holiday worked (warned)</option>
                  {fits.map((o) => (
                    <option key={o.holiday} value={o.holiday}>
                      {o.name}, {dayLabel(o.holiday)} (by {dayLabel(o.expires)})
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
        {/* A holiday worked that isn't listed yet: added here, then picked for the first chosen day it fits. */}
        {days.length > 0 && (
          <HolidayWorkedForm
            employeeId={data.employee.id}
            before={days[0]!.date}
            onAdded={(h) =>
              setChoice((c) => {
                const d = days.find((x) => !c[x.date] && h < x.date && x.date <= chExpires(h));
                return d ? { ...c, [d.date]: h } : c;
              })
            }
          />
        )}
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
