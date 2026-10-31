// Quick attendance marking (user request 2026-10-31, "/markattendance: a plain page with a drop-down of every
// employee, CL, CH (chosen from holiday duty already done) or Off, a from and a to date; only a from date is that day
// alone; mainly for phones, a standalone page"). Outside the app's shell (no menu, top bar or tab bar; App.tsx), it
// scrolls by itself. It marks through the register's own routes, so every rule holds there: holidays and leave are
// left out, an off only once earned, a CH only for a holiday worked within 3 months, and each mark is in History.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck } from "lucide-react";
import { MARK_NAME, chFits, offByItself, offLine } from "../../shared/attendance";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAttendance, useAttendanceActions, useMe, useStaff } from "../api";
import { Button, Card, ErrorNote, Loading, cx, inputClass } from "../components/ui";

type Kind = "cl" | "ch" | "off";
const KINDS: { value: Kind; label: string }[] = [
  { value: "cl", label: "CL" },
  { value: "ch", label: "CH" },
  { value: "off", label: "Off" },
];
const MAX_DAYS = 62;

// Every day from–to, both counted (at most MAX_DAYS).
function daysFrom(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to && out.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export function MarkAttendancePage() {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const staff = useStaff().data;
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<Kind>("cl");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [replace, setReplace] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const month = useAttendance((from || today).slice(0, 7)).data;
  const { mark, markCh } = useAttendanceActions();
  // Fresh figures each time the page opens (holiday duty, CL taken, offs due), not a copy saved on the phone.
  const qc = useQueryClient();
  useEffect(() => void qc.invalidateQueries({ queryKey: ["attendance"] }), [qc]);

  const people = staff?.employees ?? [];
  const groups = [
    ...(staff?.designations ?? []).map((d) => ({ label: d.name, list: people.filter((e) => e.designationId === d.id) })),
    { label: "No designation", list: people.filter((e) => !e.designationId || !staff?.designations.some((d) => d.id === e.designationId)) },
  ]
    .map((g) => ({ ...g, list: g.list.filter((e) => !e.leftOn).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.list.length);
  const person = people.find((e) => e.id === employeeId);
  const weekly = person?.offDay === "weekly";
  // An off is for weekly-off staff only.
  useEffect(() => {
    if (kind === "off" && person && !weekly) setKind("cl");
  }, [kind, person, weekly]);

  const last = to && to >= from ? to : from;
  const dates = from ? daysFrom(from, last) : [];
  // Days that can take a CL, CH or off: not a holiday of the register (known for the from date's month) and, for
  // Sunday-off staff, not a Sunday.
  const holidayOf = new Map((month?.days ?? []).map((d) => [d.date, d.holiday]));
  const working = dates.filter((d) => !person || !offByItself(d, holidayOf.get(d) ?? null, person.offDay));

  // CH: each day with a holiday worked whose CH is still open then (the oldest first, each holiday once).
  const open = useMemo(() => (month?.chOpen ?? []).filter((o) => o.employeeId === employeeId).sort((a, b) => a.holiday.localeCompare(b.holiday)), [month, employeeId]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const workingKey = working.join(",");
  useEffect(() => {
    if (kind !== "ch") return;
    const c: Record<string, string> = {};
    const used = new Set<string>();
    for (const d of working) {
      const o = open.find((x) => chFits(x, d) && !used.has(x.holiday));
      if (o) {
        c[d] = o.holiday;
        used.add(o.holiday);
      }
    }
    setChoice(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, workingKey, open]);
  const chItems = Object.entries(choice).filter(([d, h]) => h && working.includes(d));

  const t = month?.totals.find((x) => x.employeeId === employeeId);
  const w = month?.weekly.find((x) => x.employeeId === employeeId);
  const figures = person && month
    ? [
        `CL ${t?.cl ?? 0} of ${month.settings.clPerYear} this year`,
        `CH ${t?.ch ?? 0}${open.length ? `, ${open.filter((o) => o.expires >= today).length} to take` : ""}`,
        w && offLine(w, month.settings.offEvery),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const busy = mark.isPending || markCh.isPending;
  const count = kind === "ch" ? chItems.length : working.length;
  const ready = !!person && !!from && count > 0 && !busy;
  const report = (r: { marked: number; skipped: Record<string, number> }, what: string) => {
    const left = Object.entries(r.skipped);
    setDone(`${what}: ${r.marked} marked${left.length ? `; left out: ${left.map(([why, n]) => `${why} ${n}`).join(", ")}` : ""}`);
    if (r.marked) setTo("");
  };
  const submit = () => {
    if (!person) return;
    setDone(null);
    if (kind === "ch") markCh.mutate({ items: chItems.map(([date, holiday]) => ({ employeeId: person.id, date, holiday })), replace }, { onSuccess: (r) => report(r, MARK_NAME.ch) });
    else mark.mutate({ cells: working.map((date) => ({ employeeId: person.id, date })), mark: kind, replace }, { onSuccess: (r) => report(r, MARK_NAME[kind]) });
  };

  return (
    // The page scrolls by itself: phones keep html and body still (the app shell's rule).
    <div className="h-dvh overflow-y-auto bg-canvas-soft">
      <div className="mx-auto max-w-md px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-title3 font-bold text-ink">
            <ClipboardCheck size={20} className="text-brand-700" /> Mark attendance
          </h1>
          <Link to="/attendance" className="text-footnote font-medium text-brand-700 hover:underline">
            Register
          </Link>
        </div>
        {!staff ? (
          <Loading className="py-10" />
        ) : (
          <Card className="space-y-4 p-4">
            <label className="block">
              <span className="mb-1 block text-footnote font-medium text-slate-700">Employee</span>
              <select className={inputClass} value={employeeId} onChange={(e) => (setEmployeeId(e.target.value), setDone(null))}>
                <option value="">Choose…</option>
                {groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.list.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {figures && <span className="mt-1 block text-footnote text-slate-500 [overflow-wrap:anywhere]">{figures}</span>}
            </label>

            <div>
              <span className="mb-1 block text-footnote font-medium text-slate-700">Mark</span>
              {/* Its own type="button" radios, so nothing submits by accident. */}
              <div role="radiogroup" aria-label="Mark" className="grid grid-cols-3 gap-2">
                {KINDS.map((k) => {
                  const off = k.value === "off" && !!person && !weekly;
                  return (
                    <button
                      key={k.value}
                      type="button"
                      role="radio"
                      aria-checked={kind === k.value}
                      disabled={off}
                      onClick={() => (setKind(k.value), setDone(null))}
                      className="h-10 rounded-lg border border-line bg-white text-sm font-semibold text-slate-700 enabled:active:scale-[0.97] disabled:opacity-40 aria-checked:border-brand-600 aria-checked:bg-brand-600 aria-checked:text-white"
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
              {person && !weekly && <span className="mt-1 block text-footnote text-slate-500">Off is for weekly-off staff; {person.name} has Sunday off.</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className="mb-1 block text-footnote font-medium text-slate-700">From</span>
                <input type="date" className={inputClass} value={from} onChange={(e) => (setFrom(e.target.value), setDone(null))} />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-footnote font-medium text-slate-700">To (optional)</span>
                <input type="date" className={inputClass} value={to} min={from} onChange={(e) => (setTo(e.target.value), setDone(null))} />
              </label>
            </div>
            <p className="-mt-2 text-footnote text-slate-500">
              {!from
                ? "Choose a date."
                : `${dates.length === 1 ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(last)}, ${dates.length} days`}${working.length < dates.length ? ` (${dates.length - working.length} off by itself left out)` : ""}`}
              {to && (
                <button type="button" onClick={() => setTo("")} className="ml-2 font-medium text-brand-700">
                  Just {from ? dayLabel(from) : "the day"}
                </button>
              )}
            </p>

            {kind === "ch" && person && (
              <div>
                <span className="mb-1 block text-footnote font-medium text-slate-700">For the holiday worked</span>
                {working.length === 0 ? null : open.length === 0 ? (
                  <p className="text-footnote text-urgent-ink">No holiday duty with a CH still to take.</p>
                ) : (
                  <ul className="space-y-2">
                    {working.map((d) => {
                      const fits = open.filter((o) => chFits(o, d));
                      const taken = new Set(Object.entries(choice).filter(([x]) => x !== d).map(([, h]) => h));
                      return (
                        <li key={d} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-footnote text-slate-600">{dayLabel(d)}</span>
                          {fits.length === 0 ? (
                            <span className="text-footnote text-slate-400">None open that day</span>
                          ) : (
                            <select className={cx(inputClass, "min-w-0 flex-1")} value={choice[d] ?? ""} onChange={(e) => setChoice({ ...choice, [d]: e.target.value })}>
                              <option value="">Not this day</option>
                              {fits.map((o) => (
                                <option key={o.holiday} value={o.holiday} disabled={taken.has(o.holiday)}>
                                  {o.name ? `${o.name}, ` : ""}
                                  {dayLabel(o.holiday)} (by {dayLabel(o.expires)})
                                </option>
                              ))}
                            </select>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-footnote text-slate-600">
              <input type="checkbox" className="size-4 accent-brand-700" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Replace marks already there
            </label>

            <Button variant="primary" className="w-full" disabled={!ready} onClick={submit}>
              {busy ? "Marking…" : `Mark ${KINDS.find((k) => k.value === kind)!.label}${count > 1 ? ` for ${count} days` : ""}`}
            </Button>
            <ErrorNote error={mark.error ?? markCh.error} />
            {done && (
              <p role="status" className="flex items-start gap-2 rounded-lg bg-low-soft px-3 py-2 text-footnote text-low-ink [overflow-wrap:anywhere]">
                <Check size={16} className="mt-px shrink-0" /> {done}
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
