// Mark leave (user request 2026-11-08, docs/ATTENDANCE_MARK_LEAVE_PLAN.md): the quick way to put what an employee
// said on the phone into the register. Employee (a drop-down), type, from (Today / Tomorrow / a date; tomorrow to start
// from 4 pm, when calls are about the next day) and the number of days or the last day.
// Phase 1, register marks: CL, ½ CL, CH, Off (weekly-off staff), OD (with a remark) and Absent fall only on the
// person's working days: holidays of the register, Sundays for Sunday-off staff, leave from the Leave page and days
// out of the office are skipped and named. CH takes a holiday worked for each day (oldest that fits first; "+ Add a
// holiday worked" when none does). Every rule the register checks is shown in full before saving (markWarnings; warn
// only, nothing is blocked), and days already marked are named and replaced. Saved through /attendance/mark or
// /attendance/ch, with Undo putting each day back.
// Phase 2, leave from the Leave page (permanent staff only): the account's leave types as a second row of chips;
// calendar days from–to as the Leave page counts them; the balance before → after and the KSR limits
// (leaveWarnings); holidays prefixed and suffixed shown for EL, HPL and commuted leave (prefixSuffix) and written into
// the leave's notes; "On a medical certificate"; for a type that doesn't count for increment (EOL) the increment and
// probation task move as on the Leave page. Saved through POST /leave/leaves (its account line, its task with the
// steps, History), with "Mark in attendance" already ticked for non-gazetted staff; register marks inside the leave
// are then cleared (/attendance/clear). Undo cancels the leave (days given back), puts the moved dates back and the
// cleared marks back.
// "Open their month" goes to Person days for day-by-day fixes. Opened by openMarkLeave(id?) from the Attendance
// page's Mark leave button (wider screens), its + button (phones) and a person's figures; lives once in the app shell
// (MarkLeaveHost).
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays } from "lucide-react";
import type { LeaveType, PersonDay } from "../../shared/types";
import { MARK_NAME, chExpires, chFits, inAttendance, markName, offStatus, offTakeBy, type AttendanceMark } from "../../shared/attendance";
import { markWarnings, prefixSuffix, workingDays } from "../../shared/markWarnings";
import { calendarDays, daysWord, formatDays, leaveShort, leaveWarnings, postponeDays, shiftDate, spellDays } from "../../shared/leave";
import { dayLabel, dayShort } from "../../shared/reminderSchedule";
import { OFF_DAY_LABELS } from "../../shared/staff";
import { useAttendanceActions, useAttendanceSettings, useEmployeeLeaves, useLeaveAccount, useLeaveActions, useLeaveTypes, useMe, usePersonWindow, useStaff, type AttendanceCell } from "../api";
import { MARK_COLOR } from "../markColors";
import { showUndo } from "./SwipeRow";
import { HolidayWorkedForm } from "./HolidayWorked";
import { openPersonDays } from "./PersonDays";
import { Button, ErrorNote, Loading, Modal, TONE, cx, inputClass } from "./ui";

let opener: ((id: string | null) => void) | null = null;
export const openMarkLeave = (id?: string) => opener?.(id ?? null);

export function MarkLeaveHost() {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  // A new key each time it opens, so the form starts afresh.
  const [round, setRound] = useState(0);
  useEffect(() => {
    opener = (who) => {
      setId(who);
      setRound((r) => r + 1);
      setOpen(true);
    };
    return () => {
      opener = null;
    };
  }, []);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Mark leave">
      {open && <MarkLeaveForm key={round} first={id} onClose={() => setOpen(false)} />}
    </Modal>
  );
}

type Kind = Exclude<AttendanceMark, "present" | "holiday">;
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "cl", label: "CL" },
  { kind: "cl_half", label: "½ CL" },
  { kind: "ch", label: "CH" },
  { kind: "off", label: "Off" },
  { kind: "od", label: "OD" },
  { kind: "absent", label: "Absent" },
];
// Register marks run a few days at most; leave can be long.
const MAX_DAYS = 30;
const MAX_LEAVE_DAYS = 365;
// Prefix / suffix holidays are for these built-in KSR types (user's answer 2026-11-08).
const PREFIX_TYPES = new Set(["el", "hpl", "commuted"]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const short = (d: string) => `${DAY_NAMES[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}`;
const TONE_OF = { red: "urgent", orange: "high", amber: "medium", blue: "info", grey: "neutral" } as const;
const holidayKind = (d: PersonDay) => (d.holiday ? { kind: d.holiday === "Second Saturday" ? ("second_saturday" as const) : ("public" as const) } : null);
// Which balance a type takes from, and how many days of it for each day of leave (as the Leave page).
const takesFrom = (t: LeaveType | undefined) => (!t ? null : t.hasAccount ? { typeId: t.id, perDay: 1 } : t.drawsOnId ? { typeId: t.drawsOnId, perDay: t.perDay } : null);
// A type chip; a register mark not chosen shows in its colour (markColors.ts).
const chip = (on: boolean, mark?: AttendanceMark) => cx("h-8 min-w-12 rounded-lg border px-3 text-sm font-medium transition active:scale-[0.97] pointer-coarse:h-9", on ? "border-brand-600 bg-brand-600 text-white" : cx("border-line bg-white hover:bg-slate-50", mark ? MARK_COLOR[mark] : "text-ink"));

// The hour now in the app's time zone (0–23).
function hourIn(tz: string | undefined) {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", ...(tz ? { timeZone: tz } : {}) }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

function MarkLeaveForm({ first, onClose }: { first: string | null; onClose: () => void }) {
  const me = useMe().data;
  const today = me?.today ?? new Date().toISOString().slice(0, 10);
  const tomorrow = shiftDate(today, 1);
  const staff = useStaff().data;
  const settings = useAttendanceSettings().data?.settings;
  const allTypes = useLeaveTypes().data?.types;
  const [id, setId] = useState<string | null>(first);
  // A register mark, or "leave" with a Leave page type (typeId).
  const [kind, setKind] = useState<Kind | "leave">("cl");
  const [typeId, setTypeId] = useState<string | null>(null);
  // Calls after office hours are about tomorrow.
  const [from, setFrom] = useState(() => (hourIn(me?.timezone) >= 16 ? tomorrow : today));
  const [by, setBy] = useState<"days" | "to">("days");
  const [count, setCount] = useState("1");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [onMedical, setOnMedical] = useState(false);
  const [moveIncrement, setMoveIncrement] = useState(true);
  const [moveProbation, setMoveProbation] = useState(true);
  // CH: the holiday worked chosen for a day ("" = not CH), where the default isn't wanted.
  const [chPick, setChPick] = useState<Record<string, string>>({});
  const { mark, clear, markCh } = useAttendanceActions();
  const { markLeave, cancelLeave, undoPostpone } = useLeaveActions();
  const qc = useQueryClient();

  const leave = kind === "leave";
  const half = kind === "cl_half";
  const max = leave ? MAX_LEAVE_DAYS : MAX_DAYS;
  const n = half ? 1 : Math.min(max, Math.max(1, Math.floor(Number(count) || 1)));
  // Leave counts calendar days, so its last day is known without the person's days.
  const leaveTo = by === "to" && to >= from ? to : by === "to" ? from : shiftDate(from, n - 1);
  // A week before `from` too, for the holidays prefixed to a leave.
  const { data, error, isPlaceholderData } = usePersonWindow(id, shiftDate(from, -7), leave && leaveTo > shiftDate(from, 52) ? shiftDate(leaveTo, 10) : shiftDate(from, 62));
  const account = useLeaveAccount(leave && id ? id : "").data;
  const theirLeaves = useEmployeeLeaves(leave && id ? id : "").data?.leaves;

  // Everyone in the register today, by designation in their order, then name.
  const people = useMemo(() => {
    if (!staff || !settings) return [];
    const order = new Map(staff.designations.map((d, i) => [d.id, i]));
    return staff.employees
      .filter((e) => (!e.joinedOfficeOn || e.joinedOfficeOn <= today) && (!e.leftOn || e.leftOn >= today) && inAttendance(e, settings))
      .sort((a, b) => (order.get(a.designationId ?? "") ?? 1e9) - (order.get(b.designationId ?? "") ?? 1e9) || a.name.localeCompare(b.name));
  }, [staff, settings, today]);
  const groups = useMemo(() => {
    const desig = new Map(staff?.designations.map((d) => [d.id, d.name]) ?? []);
    const out: { name: string; people: typeof people }[] = [];
    for (const e of people) {
      const name = desig.get(e.designationId ?? "") ?? "No designation";
      if (out.at(-1)?.name === name) out.at(-1)!.people.push(e);
      else out.push({ name, people: [e] });
    }
    return out;
  }, [people, staff]);
  const employee = staff?.employees.find((e) => e.id === id);
  const permanent = !!employee?.permanent;
  const types = useMemo(() => (allTypes ?? []).filter((t) => t.active), [allTypes]);
  const type = types.find((t) => t.id === typeId);

  const weekly = data?.employee.offDay === "weekly";
  // Off is for weekly-off staff only, leave for permanent staff only.
  useEffect(() => {
    if ((data && !weekly && kind === "off") || (employee && !permanent && kind === "leave")) setKind("cl");
  }, [data, weekly, kind, employee, permanent]);

  // Register marks: the person's working days.
  const range = useMemo(() => (data && !leave ? workingDays(data, from, by === "days" ? n : null, by === "to" && to >= from ? to : by === "to" ? from : null) : null), [data, leave, from, by, n, to]);
  const dates = range?.dates ?? [];
  const short_ = !leave && by === "days" && dates.length < n;
  const selected = useMemo(() => new Set(dates), [dates]);
  const warnings = useMemo(() => (data && !leave && dates.length ? (markWarnings(data, selected)[kind as Kind] ?? []) : []), [data, leave, selected, kind, dates.length]);
  const dayOf = useMemo(() => new Map(data?.days.map((d) => [d.date, d]) ?? []), [data]);
  const chosen = dates.map((d) => dayOf.get(d)!).filter(Boolean);
  // Days with another mark (or another remark for OD) that saving replaces.
  const replaced = chosen.filter((d) => d.mark && (d.mark !== kind || (kind === "od" && d.note !== note.trim())));

  // Leave: its days, the marks inside it (cleared on saving), the holidays around it, the balance and the KSR limits.
  const leaveDays = leave ? calendarDays(from, leaveTo) : 0;
  const inside = leave && data ? data.days.filter((d) => d.date >= from && d.date <= leaveTo && d.mark) : [];
  const around = leave && data && type?.ksrKey && PREFIX_TYPES.has(type.ksrKey) ? prefixSuffix(data, from, leaveTo) : null;
  const source = takesFrom(type);
  const sourceType = source ? types.find((t) => t.id === source.typeId) ?? allTypes?.find((t) => t.id === source.typeId) : undefined;
  const before = (source && account?.balances.find((b) => b.typeId === source.typeId)?.balance) ?? 0;
  const after = source ? before - leaveDays * source.perDay : null;
  const notEnough = after != null && after < 0 && !type?.mayGoNegative;
  const usedType = (type && account?.used.find((u) => u.typeId === type.id)) || null;
  const pastService = type?.serviceLimit != null && (usedType?.days ?? 0) + leaveDays > type.serviceLimit;
  const leaveWarns =
    leave && type && account && theirLeaves
      ? leaveWarnings({
          type,
          days: leaveDays,
          onMedical,
          usedNonMedical: usedType?.nonMedical ?? 0,
          spell: type.spellLimit != null ? spellDays(theirLeaves, from, leaveTo, leaveDays, new Set(types.filter((t) => t.spellLimit != null).map((t) => t.id))) : leaveDays,
          atCredit: (allTypes ?? []).filter((t) => t.hasAccount).map((t) => ({ short: leaveShort(t), balance: account.balances.find((b) => b.typeId === t.id)?.balance ?? 0 })),
        })
      : [];
  const delays = leave && !!type?.delaysIncrement && !onMedical;
  const offerIncrement = delays && !!employee?.nextIncrementOn;
  const offerProbation = delays && !!employee && !employee.probationDeclared && !employee.probationDeclaredOn;

  // CH: the holiday worked for each day, the oldest that fits first, each holiday once.
  const chFor = useMemo(() => {
    const out: Record<string, string> = {};
    if (!data || kind !== "ch") return out;
    const used = new Set(Object.entries(chPick).filter(([d, h]) => h && selected.has(d)).map(([, h]) => h));
    for (const d of dates) {
      if (d in chPick) {
        out[d] = chPick[d]!;
        continue;
      }
      const o = data.chOpen.find((x) => chFits(x, d) && !used.has(x.holiday) && !data.days.some((y) => y.chHoliday === x.holiday && !selected.has(y.date)));
      if (o) {
        out[d] = o.holiday;
        used.add(o.holiday);
      }
    }
    return out;
  }, [data, kind, dates, selected, chPick]);
  const chItems = Object.entries(chFor)
    .filter(([d, h]) => h && selected.has(d))
    .map(([date, holiday]) => ({ employeeId: id!, date, holiday }));

  const busy = mark.isPending || clear.isPending || markCh.isPending || markLeave.isPending;
  const howMany = leave ? leaveDays : kind === "ch" ? chItems.length : dates.length;
  const label = leave ? `Mark ${type ? leaveShort(type) : "leave"} for ${daysWord(leaveDays)}` : half ? `Mark ½ CL${dates[0] ? ` on ${short(dates[0])}` : ""}` : `Mark ${KINDS.find((k) => k.kind === kind)!.label} for ${plural(howMany, "day")}`;

  // Undo for register marks: each day back to what it had (a CH with its holiday, an OD with its remark) or nothing.
  const restoreMarks = (employeeId: string, was: PersonDay[]) => {
    const cellsOf = (list: { date: string }[]): AttendanceCell[] => list.map((d) => ({ employeeId, date: d.date }));
    const none = was.filter((d) => !d.mark);
    if (none.length) clear.mutate(cellsOf(none));
    const chs = was.filter((d) => d.mark === "ch" && d.chHoliday);
    if (chs.length) markCh.mutate({ items: chs.map((d) => ({ employeeId, date: d.date, holiday: d.chHoliday! })), replace: true });
    for (const m of ["present", "off", "cl", "cl_half", "absent", "holiday"] as const) {
      const these = was.filter((d) => d.mark === m);
      if (these.length) mark.mutate({ cells: cellsOf(these), mark: m, replace: true });
    }
    for (const d of was.filter((x) => x.mark === "od")) mark.mutate({ cells: cellsOf([d]), mark: "od", replace: true, note: d.note });
  };

  const save = async () => {
    if (!data || !id || !howMany) return;
    const e = data.employee;
    const cellsOf = (list: { date: string }[]): AttendanceCell[] => list.map((d) => ({ employeeId: e.id, date: d.date }));
    if (leave) {
      if (!type) return;
      const days = (list: { date: string; name: string }[]) => list.map((x) => `${dayLabel(x.date)} (${x.name})`).join(", ");
      const prefixNote = around && (around.prefix.length || around.suffix.length) ? `Prefix: ${around.prefix.length ? days(around.prefix) : "none"}; suffix: ${around.suffix.length ? days(around.suffix) : "none"}` : "";
      const notes = [note.trim(), prefixNote].filter(Boolean).join("\n");
      const was = inside.map((d) => ({ ...d }));
      try {
        const r = await markLeave.mutateAsync({
          employeeId: e.id,
          typeId: type.id,
          fromDate: from,
          toDate: leaveTo,
          days: leaveDays,
          onMedical,
          notes,
          // The leave is in the register now (non-gazetted steps; gazetted ones have no such step).
          doneSteps: employee?.gazetted ? [] : ["attendance"],
          postpone: { increment: offerIncrement && moveIncrement, probation: offerProbation && moveProbation },
        });
        // Register marks inside the leave go, so the register shows the leave.
        if (was.length) await clear.mutateAsync(cellsOf(was)).catch(() => null);
        qc.invalidateQueries({ queryKey: ["attendance"] });
        const moved = [r.postponed.increment && `next increment to ${dayLabel(r.postponed.increment.to)}`, r.postponed.probation && `probation task to ${dayLabel(r.postponed.probation.to)}`].filter(Boolean);
        showUndo({
          message: `${leaveShort(type)}: ${daysWord(leaveDays)} for ${e.name}, with its task${moved.length ? `; ${moved.join(", ")}` : ""}`,
          onUndo: () => {
            cancelLeave.mutate(r.id, { onSettled: () => qc.invalidateQueries({ queryKey: ["attendance"] }) });
            if (moved.length) undoPostpone.mutate({ id: r.id, ...r.postponed });
            if (was.length) restoreMarks(e.id, was);
          },
        });
        onClose();
      } catch {
        // shown under the form
      }
      return;
    }
    const was = chosen.map((d) => ({ ...d }));
    const done = (r: { marked: number; skipped: Record<string, number> }, what: string) => {
      const left = Object.entries(r.skipped);
      showUndo({ message: `${what}: ${plural(r.marked, "day")} for ${e.name}${left.length ? `; left out: ${left.map(([why, k]) => `${why} ${k}`).join(", ")}` : ""}`, onUndo: r.marked ? () => restoreMarks(e.id, was) : undefined });
      onClose();
    };
    if (kind === "ch") markCh.mutate({ items: chItems, replace: true }, { onSuccess: (r) => done(r, "CH") });
    else mark.mutate({ cells: cellsOf(chosen), mark: kind, replace: true, note: kind === "od" ? note.trim() : "" }, { onSuccess: (r) => done(r, MARK_NAME[kind]) });
  };

  if (!staff || !settings) return <Loading />;
  const st = data?.weekly && data.weekly.countFrom ? offStatus(data.weekly, data.settings) : null;
  const chToTake = data ? data.chOpen.filter((o) => o.expires >= data.today) : [];
  const shownDays = leave ? (by === "days" ? count : String(leaveDays)) : by === "days" ? count : String(dates.length || "");
  const shownTo = leave ? leaveTo : by === "to" ? to : (dates.at(-1) ?? "");
  return (
    <form
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <label className="block space-y-1">
        <span className="text-footnote font-medium text-slate-600">Employee</span>
        <select className={inputClass} value={id ?? ""} onChange={(ev) => (setId(ev.target.value || null), setChPick({}))} required>
          <option value="">Choose the employee…</option>
          {groups.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.people.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {id && data && (
        <div className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-slate-600">
          <span>{weekly ? OFF_DAY_LABELS.weekly : OFF_DAY_LABELS.sunday}</span>
          {st && data.weekly && (
            <span className={cx("rounded-full px-2 py-0.5 font-medium", TONE[TONE_OF[st.tone]].soft)}>
              Day {data.weekly.run} · {st.text}
            </span>
          )}
          {data.weekly?.owedSince[0] && (
            <span className={offTakeBy(data.weekly.owedSince[0]) < data.today ? "font-medium text-urgent-ink" : undefined}>
              {offTakeBy(data.weekly.owedSince[0]) < data.today ? `off owed since ${dayShort(data.weekly.owedSince[0])}: over a month` : `take the off by ${dayShort(offTakeBy(data.weekly.owedSince[0]))}`}
            </span>
          )}
          <span>
            CL {data.cl} of {data.settings.clPerYear}
          </span>
          <span>
            CH {data.ch}
            {data.chLimit === null ? "" : ` of ${data.chLimit}`}
            {chToTake.length > 0 && `, ${chToTake.length} to take (first by ${dayShort(chToTake.map((o) => o.expires).sort()[0]!)})`}
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              openPersonDays(id);
            }}
            className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
          >
            <CalendarDays size={14} aria-hidden /> Open their month
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        <span className="block text-footnote font-medium text-slate-600" id="ml-type">
          Type
        </span>
        <div role="radiogroup" aria-labelledby="ml-type" className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {KINDS.filter((k) => k.kind !== "off" || !data || weekly).map((k) => (
              <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)} className={chip(kind === k.kind, k.kind)}>
                {k.label}
              </button>
            ))}
          </div>
          {/* Leave from the Leave page: permanent staff only (the Leave page keeps no accounts for temporary staff). */}
          {(!employee || permanent) && types.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-caption text-slate-500">Leave (also on the Leave page, with its task)</span>
              {types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={leave && typeId === t.id}
                  title={t.name}
                  onClick={() => {
                    setKind("leave");
                    setTypeId(t.id);
                    setOnMedical(t.medical);
                  }}
                  className={chip(leave && typeId === t.id)}
                >
                  {leaveShort(t)}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-caption text-slate-500">{leave ? type?.name : kind === "off" ? "Weekly off" : kind === "od" ? "On duty elsewhere (counts as present)" : MARK_NAME[kind]}</p>
      </div>

      <div className="space-y-1">
        <span className="block text-footnote font-medium text-slate-600">From</span>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { day: today, label: "Today" },
            { day: tomorrow, label: "Tomorrow" },
          ].map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={from === c.day}
              onClick={() => setFrom(c.day)}
              className={cx("h-8 rounded-lg border px-3 text-sm font-medium transition active:scale-[0.97] pointer-coarse:h-9", from === c.day ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line bg-white text-ink hover:bg-slate-50")}
            >
              {c.label}
            </button>
          ))}
          <input type="date" className={cx(inputClass, "w-auto min-w-0 flex-1 basis-40")} value={from} onChange={(ev) => ev.target.value && setFrom(ev.target.value)} aria-label="From date" required />
        </div>
      </div>

      {!half && (
        <div className="grid gap-3 min-[420px]:grid-cols-[8rem_1fr]">
          <label className="block space-y-1">
            <span className="text-footnote font-medium text-slate-600">Days</span>
            <input type="number" inputMode="numeric" min={1} max={max} className={inputClass} value={shownDays} onChange={(ev) => (setCount(ev.target.value), setBy("days"))} aria-label="Number of days" />
          </label>
          <label className="block space-y-1">
            <span className="text-footnote font-medium text-slate-600">or the last day</span>
            <input type="date" className={inputClass} min={from} value={shownTo} onChange={(ev) => (setTo(ev.target.value), setBy("to"))} aria-label="Last day" />
          </label>
        </div>
      )}

      {(kind === "od" || leave) && (
        <label className="block space-y-1">
          <span className="text-footnote font-medium text-slate-600">{leave ? "Notes (optional)" : "OD remark"}</span>
          <input className={inputClass} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={leave ? 1500 : 200} placeholder={leave ? "Reason, order number…" : "Where, why (optional)"} />
        </label>
      )}
      {leave && type && (
        <label className="-my-1 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
          <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={onMedical} onChange={(ev) => setOnMedical(ev.target.checked)} />
          <span className="text-sm text-ink">On a medical certificate</span>
        </label>
      )}

      {id && !data && !error && <Loading />}
      <ErrorNote error={error} />
      {id && data && range && (
        <div className="space-y-2 rounded-xl border border-line bg-slate-50 p-3 text-sm">
          {dates.length === 0 ? (
            <p className="text-slate-600">No working day to mark from {dayLabel(from)}.</p>
          ) : (
            <p className="text-ink [overflow-wrap:anywhere]">
              <span className="font-medium">{plural(dates.length, "day")}:</span> {dates.map(short).join(" · ")}
            </p>
          )}
          {range.skipped.length > 0 && <p className="text-footnote text-slate-500 [overflow-wrap:anywhere]">Skipped: {range.skipped.map((x) => `${short(x.date)} (${x.why})`).join(", ")}</p>}
          {short_ && dates.length > 0 && <p className="text-footnote text-slate-500">Only {plural(dates.length, "working day")} could be counted; choose a last day for more.</p>}
          {replaced.length > 0 && <p className="text-footnote text-slate-600 [overflow-wrap:anywhere]">Already marked, will be replaced: {replaced.map((d) => `${short(d.date)} (${markName(d.mark!, holidayKind(d))})`).join(", ")}</p>}
          {chosen.some((d) => d.date > data.today) && <p className="text-caption text-slate-500">Days still to come show lighter in the register until they come.</p>}
        </div>
      )}

      {id && data && leave && type && (
        <div className="space-y-2 rounded-xl border border-line bg-slate-50 p-3 text-sm">
          <p className="text-ink">
            <span className="font-medium">{daysWord(leaveDays)}:</span> {dayLabel(from)}
            {leaveTo !== from && ` to ${dayLabel(leaveTo)}`} · back on {dayLabel(shiftDate(leaveTo, 1))}
          </p>
          {around && (
            <p className="text-footnote text-slate-600 [overflow-wrap:anywhere]">
              Prefix: {around.prefix.length ? around.prefix.map((x) => `${short(x.date)} (${x.name})`).join(", ") : "none"} · Suffix: {around.suffix.length ? around.suffix.map((x) => `${short(x.date)} (${x.name})`).join(", ") : "none"}
            </p>
          )}
          {sourceType && after != null ? (
            <p className={cx("text-footnote", notEnough ? "font-medium text-urgent-ink" : "text-slate-600")}>
              {leaveShort(sourceType)} balance: {formatDays(before)} → {formatDays(after)}
              {source!.perDay !== 1 && ` (${formatDays(source!.perDay)} days of ${leaveShort(sourceType)} for each day)`}
              {notEnough && ": not enough balance"}
            </p>
          ) : (
            <p className="text-footnote text-slate-600">{type.name} doesn't take from a leave balance.</p>
          )}
          {inside.length > 0 && <p className="text-footnote text-slate-600 [overflow-wrap:anywhere]">Register marks inside the leave are cleared: {inside.map((d) => `${short(d.date)} (${markName(d.mark!, holidayKind(d))})`).join(", ")}</p>}
          <p className="text-caption text-slate-500">Saved on the Leave page with its task{employee?.gazetted ? "" : " (Mark in attendance already ticked)"}.</p>
        </div>
      )}
      {(offerIncrement || offerProbation) && leaveDays > 0 && (
        <fieldset className="rounded-lg border border-line px-3 py-2">
          <legend className="px-1 text-sm font-medium text-ink">{type!.name} doesn't count for increment or probation</legend>
          {offerIncrement && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
              <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={moveIncrement} onChange={(ev) => setMoveIncrement(ev.target.checked)} />
              <span className="text-sm text-ink">
                Move the next increment by {daysWord(postponeDays(leaveDays))}: {dayLabel(employee!.nextIncrementOn!)} → {dayLabel(shiftDate(employee!.nextIncrementOn!, postponeDays(leaveDays)))}
              </span>
            </label>
          )}
          {offerProbation && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
              <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={moveProbation} onChange={(ev) => setMoveProbation(ev.target.checked)} />
              <span className="text-sm text-ink">Move the Probation declaration task's due date by {daysWord(postponeDays(leaveDays))} (when there is one)</span>
            </label>
          )}
        </fieldset>
      )}

      {id && data && kind === "ch" && dates.length > 0 && (
        <div className="space-y-2">
          <span className="block text-footnote font-medium text-slate-600">Holiday worked for each CH</span>
          <ul className="space-y-2">
            {dates.map((d) => {
              const fits = data.chOpen.filter((o) => chFits(o, d) && (chFor[d] === o.holiday || !Object.entries(chFor).some(([k, h]) => k !== d && h === o.holiday)));
              return (
                <li key={d} className="grid gap-1 min-[420px]:grid-cols-[7rem_1fr] min-[420px]:items-center">
                  <span className="text-sm text-slate-700">{dayLabel(d)}</span>
                  {fits.length === 0 ? (
                    <span className="text-footnote text-urgent-ink">No holiday worked open for this day</span>
                  ) : (
                    <select className={inputClass} value={chFor[d] ?? ""} onChange={(ev) => setChPick((c) => ({ ...c, [d]: ev.target.value }))} aria-label={`Holiday for the CH on ${dayLabel(d)}`}>
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
          <HolidayWorkedForm
            employeeId={id}
            before={dates[0]!}
            onAdded={(h) => {
              const d = dates.find((x) => !chFor[x] && h < x && x <= chExpires(h));
              if (d) setChPick((c) => ({ ...c, [d]: h }));
            }}
          />
        </div>
      )}

      {(warnings.length > 0 || leaveWarns.length > 0 || pastService) && (
        <div role="status" className="space-y-1.5 rounded-xl border border-medium/40 bg-medium-soft p-3">
          {warnings.map((w, i) => (
            <p key={i} className="flex gap-2 text-sm text-medium-ink">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {w.text} <span className="block text-caption opacity-80">{w.rule}</span>
              </span>
            </p>
          ))}
          {[...(pastService ? [`${leaveShort(type!)} in the whole service would be ${formatDays((usedType?.days ?? 0) + leaveDays)} of ${formatDays(type!.serviceLimit!)} days.`] : []), ...leaveWarns].map((w) => (
            <p key={w} className="flex gap-2 text-sm text-medium-ink">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">{w}</span>
            </p>
          ))}
          <p className="text-caption text-medium-ink/80">You can still mark it.</p>
        </div>
      )}

      <ErrorNote error={mark.error ?? markCh.error ?? markLeave.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!id || !data || isPlaceholderData || busy || howMany === 0 || (leave && !type)}>
          {label}
        </Button>
      </div>
    </form>
  );
}
