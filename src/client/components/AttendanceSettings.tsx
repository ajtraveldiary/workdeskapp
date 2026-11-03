// Settings › Attendance (user request 2026-10-31, docs/ATTENDANCE_PLAN.md phase 1): the office's holidays month by
// month (tap a date to make it a holiday and name it, tap again to rename or remove it), second Saturdays as
// holidays (a switch) and the days of casual leave a year. The register shades these days for everyone. Phase 2: the
// CH limit a year of each post (G.O.(Ms) 43/2021/H&FWD) and each employee's starting figures. 2026-11-03: who is in the
// register (RegisterPeople: hide temporary staff, leave people out); Clear all attendance (ClearAll, typed "clear all").
import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Play, Plus, Trash2, X } from "lucide-react";
import { openStartRegister } from "./StartRegister";
import { CH_LIMIT_CHOICES, DEFAULT_ATTENDANCE_SETTINGS, inAttendance, WEEKDAY_LETTER, guessChLimit, isSecondSaturday, monthDays, monthLabel, shiftMonth, weekdayOf, type StartFigures } from "../../shared/attendance";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAttendanceActions, useAttendanceSettings, useHolidays, useMe, useStaff } from "../api";
import { Button, Card, ErrorNote, Field, Loading, cx, inputClass } from "./ui";

export function AttendanceSettings() {
  return (
    <>
      <HolidayCalendar />
      <RegisterSettings />
      <RegisterPeople />
      <ChLimits />
      <StartingFigures />
      <ClearAll />
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
  // Weekly off (the user's rules): days that earn an off, and the most days in a row without one.
  const [every, setEvery] = useState("");
  const [max, setMax] = useState("");
  useEffect(() => {
    if (!data) return;
    setCl(String(data.settings.clPerYear));
    setEvery(String(data.settings.offEvery));
    setMax(String(data.settings.maxRun));
  }, [data]);
  if (!data) return null;
  const s = data.settings;
  const n = Number(cl);
  const e = Number(every);
  const m = Number(max);
  const weeklyOk = Number.isInteger(e) && e >= 2 && e <= 13 && Number.isInteger(m) && m >= 3 && m <= 31;
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Register</h2>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
        <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={s.secondSaturday} onChange={(e) => saveSettings.mutate({ ...s, secondSaturday: e.target.checked })} />
        <span className="text-sm text-ink">Second Saturdays are holidays</span>
      </label>
      {/* "Count days not marked as duty" was removed 2026-11-03: a day left empty is never duty. */}
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
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Weekly off: days of work for an off</span>
          <input type="number" inputMode="numeric" min={2} max={13} className={cx(inputClass, "w-28")} value={every} onChange={(ev) => setEvery(ev.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Most days in a row</span>
          <input type="number" inputMode="numeric" min={3} max={31} className={cx(inputClass, "w-28")} value={max} onChange={(ev) => setMax(ev.target.value)} />
        </label>
        {(every !== String(s.offEvery) || max !== String(s.maxRun)) && (
          <Button onClick={() => saveSettings.mutate({ ...s, offEvery: e, maxRun: m })} disabled={!weeklyOk || saveSettings.isPending}>
            <Check size={15} /> Save
          </Button>
        )}
      </div>
      <p className="mt-1 text-footnote text-slate-500">For weekly-off staff: 6 days of work earn the 7th day off, and everyone takes an off after at most 12 days in a row (more is flagged).</p>
      <ErrorNote error={saveSettings.error} />
    </Card>
  );
}

// Who is in the register (user request 2026-11-03): temporary staff hidden altogether, and anyone left out one by one;
// their marks are kept, they just aren't listed, counted or reminded about. Saved at once.
function RegisterPeople() {
  const staff = useStaff().data;
  const { data } = useAttendanceSettings();
  const { saveSettings } = useAttendanceActions();
  if (!staff || !data) return null;
  const s = data.settings;
  const groups = [
    ...staff.designations.map((d) => ({ id: d.id, name: d.name })),
    { id: "", name: "No designation" },
  ]
    .map((g) => ({ ...g, people: staff.employees.filter((e) => !e.leftOn && (g.id ? e.designationId === g.id : !e.designationId || !staff.designations.some((d) => d.id === e.designationId))).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.people.length);
  const leftOut = new Set(s.leftOut);
  const setIn = (id: string, keep: boolean) => saveSettings.mutate({ ...s, leftOut: keep ? s.leftOut.filter((x) => x !== id) : [...s.leftOut, id] });
  const listed = staff.employees.filter((e) => !e.leftOn && inAttendance(e, s)).length;
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Who is in the register</h2>
      <p className="mt-1 text-sm text-slate-600">Untick someone who isn't in the attendance register: they leave the register, Today, the Offs board and the reminders. Their marks are kept, and ticking them again brings them back. {listed} listed now.</p>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
        <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={s.hideTemporary} onChange={(e) => saveSettings.mutate({ ...s, hideTemporary: e.target.checked })} />
        <span className="text-sm text-ink">Hide temporary staff altogether</span>
      </label>
      <div className="mt-2 space-y-3">
        {groups.map((g) => (
          <div key={g.id || "none"}>
            <p className="mb-1 text-footnote font-semibold text-slate-600">{g.name}</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {g.people.map((e) => {
                const hidden = s.hideTemporary && !e.permanent;
                return (
                  <li key={e.id}>
                    <label className={cx("flex min-h-11 items-center gap-2.5 px-3 py-1.5", hidden ? "cursor-default opacity-60" : "cursor-pointer hover:bg-slate-50")}>
                      <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={!hidden && !leftOut.has(e.id)} disabled={hidden || saveSettings.isPending} onChange={(ev) => setIn(e.id, ev.target.checked)} aria-label={`${e.name} in the register`} />
                      <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{e.name}</span>
                      {!e.permanent && <span className="shrink-0 rounded bg-high-soft px-1.5 text-caption font-medium text-high-ink">{hidden ? "Temporary: hidden" : "Temporary"}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <ErrorNote error={saveSettings.error} />
    </Card>
  );
}

// The CH limit a year of each post (G.O.(Ms) 43/2021/H&FWD): saved when changed; a post not set yet shows the one its
// name suggests (nurses no limit; attenders, nursing assistants and hospital workers 45; others 22).
function ChLimits() {
  const staff = useStaff().data;
  const { data } = useAttendanceSettings();
  const { saveSettings } = useAttendanceActions();
  if (!staff || !data) return null;
  const s = data.settings;
  const value = (id: string, name: string) => (id in s.chLimits ? s.chLimits[id] : guessChLimit(name));
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Compensation leave (CH) a year</h2>
      <p className="mt-1 text-sm text-slate-600">One CH for each holiday worked, taken within 3 months, at most 10 held at once (G.O.(Ms) No. 43/2021/H&amp;FWD). The yearly limit depends on the post; the register warns past it.</p>
      {staff.designations.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No designations yet (Settings › Employees).</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {staff.designations.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{d.name}</span>
              <select
                className={cx(inputClass, "w-auto max-w-full")}
                value={String(value(d.id, d.name))}
                onChange={(e) => saveSettings.mutate({ ...s, chLimits: { ...s.chLimits, [d.id]: e.target.value === "null" ? null : Number(e.target.value) } })}
                aria-label={`CH a year for ${d.name}`}
              >
                {CH_LIMIT_CHOICES.map((c) => (
                  <option key={String(c.value)} value={String(c.value)}>
                    {c.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={saveSettings.error} />
    </Card>
  );
}

// Figures from before the register was kept (user's choice: per employee): as on a date, CL taken that year, the
// holidays worked whose CH is still to take, and for weekly-off staff the offs due and the days towards the next.
function StartingFigures() {
  const staff = useStaff().data;
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { data } = useAttendanceSettings();
  const { saveSettings } = useAttendanceActions();
  const [who, setWho] = useState("");
  const [f, setF] = useState<StartFigures | null>(null);
  if (!staff || !data) return null;
  const s = data.settings;
  const people = staff.employees.filter((e) => !e.leftOn).sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (id: string) => staff.employees.find((e) => e.id === id)?.name ?? "Employee";
  const weekly = staff.employees.find((e) => e.id === who)?.offDay === "weekly";
  const pick = (id: string) => {
    setWho(id);
    setF(id ? (s.start[id] ?? { asOn: today, clTaken: 0, chOpen: [], offsDue: 0, towards: 0 }) : null);
  };
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (!who || !f) return;
    saveSettings.mutate({ ...s, start: { ...s.start, [who]: { ...f, chOpen: f.chOpen.filter((c) => c.date) } } }, { onSuccess: () => pick("") });
  };
  const remove = (id: string) => {
    const { [id]: _gone, ...rest } = s.start;
    saveSettings.mutate({ ...s, start: rest });
  };
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 font-semibold text-slate-900">Starting figures</h2>
        {/* Everyone at once, from each person's last off (2026-11-02). */}
        <Button size="sm" variant="primary" onClick={() => openStartRegister()}>
          <Play size={15} /> Start the register
        </Button>
      </div>
      <p className="mt-1 text-sm text-slate-600">For a register started part way through the year: what each person had already, as on a date. The register counts on from the day after. Start the register sets everyone at once; below, one person at a time.</p>
      {Object.keys(s.start).length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {Object.entries(s.start).map(([id, x]) => (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <button type="button" onClick={() => pick(id)} className="min-w-0 flex-1 text-left text-ink hover:text-brand-700 [overflow-wrap:anywhere]">
                {nameOf(id)}
                <span className="block text-footnote text-slate-500">
                  As on {dayLabel(x.asOn)}: CL {x.clTaken}, CH to take {x.chOpen.length}
                  {staff.employees.find((e) => e.id === id)?.offDay === "weekly" ? `, ${x.lastOff ? `last off ${dayLabel(x.lastOff)}, ` : ""}offs owed ${x.offsDue}, ${x.towards} days carried` : ""}
                </span>
              </button>
              <button type="button" onClick={() => remove(id)} aria-label={`Remove ${nameOf(id)}'s starting figures`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-urgent-ink active:scale-90">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="mt-3 space-y-3">
        <Field label="Employee">
          <select className={inputClass} value={who} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose…</option>
            {people.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        {who && f && (
          <>
            <div className="grid gap-3 min-[420px]:grid-cols-2">
              <Field label="As on">
                <input type="date" required className={inputClass} value={f.asOn} onChange={(e) => setF({ ...f, asOn: e.target.value })} />
              </Field>
              <Field label="CL taken that year (days)">
                <input type="number" inputMode="decimal" min={0} max={60} step={0.5} className={inputClass} value={f.clTaken} onChange={(e) => setF({ ...f, clTaken: num(e.target.value) })} />
              </Field>
              {weekly && (
                <>
                  <Field label="Offs owed">
                    <input type="number" inputMode="numeric" min={-30} max={60} step={1} className={inputClass} value={f.offsDue} onChange={(e) => setF({ ...f, offsDue: num(e.target.value) })} />
                  </Field>
                  <Field label={`Days carried towards the next off (0–${s.offEvery - 1})`}>
                    <input type="number" inputMode="numeric" min={0} max={s.offEvery - 1} step={1} className={inputClass} value={f.towards} onChange={(e) => setF({ ...f, towards: num(e.target.value) })} />
                  </Field>
                </>
              )}
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Holidays worked, CH still to take</span>
              <ul className="space-y-2">
                {f.chOpen.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <input type="date" className={cx(inputClass, "w-auto")} value={c.date} onChange={(e) => setF({ ...f, chOpen: f.chOpen.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} aria-label="Holiday worked" />
                    <input className={cx(inputClass, "min-w-0 flex-1")} value={c.name} onChange={(e) => setF({ ...f, chOpen: f.chOpen.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} maxLength={100} placeholder="Holiday, e.g. Onam" aria-label="Holiday's name" />
                    <button type="button" onClick={() => setF({ ...f, chOpen: f.chOpen.filter((_, j) => j !== i) })} aria-label="Remove this holiday" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 active:scale-90">
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" variant="ghost" onClick={() => setF({ ...f, chOpen: [...f.chOpen, { date: "", name: "" }] })} className="mt-1">
                <Plus size={15} /> Add a holiday worked
              </Button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => pick("")}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saveSettings.isPending}>
                <Check size={15} /> Save
              </Button>
            </div>
          </>
        )}
      </form>
      <ErrorNote error={saveSettings.error} />
    </Card>
  );
}

// Clear all attendance (user request 2026-11-03, "type clear all to confirm deletion"): every mark, planned off and
// count correction; holidays, starting figures and these settings stay. No Undo, so the words must be typed.
function ClearAll() {
  const { clearAll } = useAttendanceActions();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState("");
  const ok = typed.trim().toLowerCase() === "clear all";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    clearAll.mutate(typed, {
      onSuccess: (r) => {
        setDone(`Cleared ${r.marks} ${r.marks === 1 ? "mark" : "marks"}, ${r.plans} planned ${r.plans === 1 ? "off" : "offs"} and ${r.corrections} ${r.corrections === 1 ? "correction" : "corrections"}.`);
        setTyped("");
        setOpen(false);
      },
    });
  };
  return (
    <Card className="border-urgent/30 p-5">
      <h2 className="font-semibold text-slate-900">Clear all attendance</h2>
      <p className="mt-1 text-sm text-slate-600">Deletes every mark in the register, the planned offs and the count corrections, for everyone. Holidays, starting figures and these settings stay. This can't be undone.</p>
      {done && <p className="mt-2 text-sm font-medium text-low-ink">{done}</p>}
      {!open ? (
        <Button variant="danger" size="sm" className="mt-3" onClick={() => { setOpen(true); setDone(""); }}>
          <Trash2 size={15} /> Clear all attendance
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Type <span className="font-semibold text-urgent-ink">clear all</span> to confirm
            </span>
            <input className={cx(inputClass, "w-full max-w-xs")} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="clear all" aria-label="Type clear all to confirm" />
          </label>
          <ErrorNote error={clearAll.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={!ok || clearAll.isPending}>
              <Trash2 size={15} /> Delete all attendance
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setTyped(""); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
