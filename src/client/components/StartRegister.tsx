// Start the register (user request 2026-11-02, "when attendance is starting everyone must have some remaining off";
// docs/ATTENDANCE_UX_PLAN.md 4.5, phase 2): everyone's starting point on one screen. As on the end of a day (yesterday
// to start), weekly-off staff give the day of their last off (or the days since it) and any offs owed from before,
// and the app works out Day N and the offs owed (fromLastOff, shown as it will be); everyone can give the CL taken this
// year. Saved together (POST /attendance/start, one History entry): the rows changed, and weekly-off staff with no
// starting point yet (left alone: start fresh). Opened with openStartRegister() from the Offs board and Settings ›
// Attendance; it lives once in the app shell.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { fromLastOff, offStatus } from "../../shared/attendance";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAttendanceSettings, useMe, useOffsBoard, useStaff, useStartRegister } from "../api";
import { showUndo } from "./SwipeRow";
import { Button, ErrorNote, Loading, Modal, TONE, cx, inputClass } from "./ui";

let opener: (() => void) | null = null;
export const openStartRegister = () => opener?.();

export function StartRegisterHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    opener = () => setOpen(true);
    return () => {
      opener = null;
    };
  }, []);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Start the register" wide>
      {open && <StartForm onDone={() => setOpen(false)} />}
    </Modal>
  );
}

type Row = { lastOff: string; days: string; extra: string; cl: string; touched: boolean };
const yesterdayOf = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
const TONE_OF = { red: "urgent", orange: "high", amber: "medium", blue: "info", grey: "neutral" } as const;

function StartForm({ onDone }: { onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const staff = useStaff().data;
  const settings = useAttendanceSettings().data?.settings;
  const board = useOffsBoard().data;
  const start = useStartRegister();
  const [asOn, setAsOn] = useState(() => yesterdayOf(today));
  const [rows, setRows] = useState<Record<string, Row> | null>(null);

  // Everyone in the office on that day, weekly-off staff first, each in designation order then name.
  const people = useMemo(() => {
    if (!staff) return [];
    const order = new Map(staff.designations.map((d, i) => [d.id, i]));
    return staff.employees
      .filter((e) => (!e.joinedOfficeOn || e.joinedOfficeOn <= asOn) && (!e.leftOn || e.leftOn >= asOn))
      .sort((a, b) => Number(b.offDay === "weekly") - Number(a.offDay === "weekly") || (order.get(a.designationId ?? "") ?? 1e9) - (order.get(b.designationId ?? "") ?? 1e9) || a.name.localeCompare(b.name));
  }, [staff, asOn]);

  // Filled in once from the starting figures already saved.
  useEffect(() => {
    if (rows || !staff || !settings) return;
    const every = settings.offEvery;
    const r: Record<string, Row> = {};
    for (const e of staff.employees) {
      const f = settings.start[e.id];
      r[e.id] = f
        ? { lastOff: f.lastOff ?? "", days: f.lastOff ? "" : String(f.run ?? ""), extra: String(f.offsDue - Math.floor((f.run ?? 0) / every)), cl: String(f.clTaken), touched: false }
        : { lastOff: "", days: "", extra: "0", cl: "0", touched: false };
    }
    setRows(r);
  }, [rows, staff, settings]);

  if (!staff || !settings || !rows) return <Loading />;
  const every = settings.offEvery;
  const started = new Map((board?.people ?? []).map((p) => [p.id, p.started]));
  const set = (id: string, patch: Partial<Row>) => setRows({ ...rows, [id]: { ...rows[id]!, ...patch, touched: true } });
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const figures = (r: Row) => {
    const extra = num(r.extra);
    if (r.lastOff) return fromLastOff(r.lastOff, asOn, extra, every);
    const days = num(r.days);
    return { run: days, towards: days % every, offsDue: extra + Math.floor(days / every) };
  };
  const bad = (r: Row) =>
    (r.lastOff && r.lastOff > asOn) ||
    !Number.isInteger(num(r.days)) ||
    num(r.days) < 0 ||
    !Number.isInteger(num(r.extra)) ||
    !Number.isInteger(num(r.cl) * 2) ||
    num(r.cl) < 0 ||
    num(r.cl) > 60;
  // Sent: the rows changed, and weekly-off staff with no starting point yet.
  const sent = people.filter((e) => rows[e.id]!.touched || (e.offDay === "weekly" && started.get(e.id) === false));
  const invalid = sent.some((e) => bad(rows[e.id]!));
  const weekly = people.filter((e) => e.offDay === "weekly");
  const sunday = people.filter((e) => e.offDay !== "weekly");
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    start.mutate(
      {
        asOn,
        people: sent.map((e) => {
          const r = rows[e.id]!;
          return { employeeId: e.id, lastOff: r.lastOff || null, days: r.lastOff ? null : num(r.days), extraOffs: num(r.extra), clTaken: num(r.cl) };
        }),
      },
      {
        onSuccess: (res) => {
          showUndo({ message: `Register started as on ${dayLabel(asOn)}: ${res.saved} ${res.saved === 1 ? "person" : "people"}` });
          onDone();
        },
      },
    );
  };
  const numberBox = (label: string, value: string, onChange: (v: string) => void, step = "1", min?: number) => (
    <label className="block min-w-0">
      <span className="block text-caption text-slate-500">{label}</span>
      <input type="number" inputMode={step === "1" ? "numeric" : "decimal"} step={step} min={min} className={cx(inputClass, "mt-0.5 w-full")} value={value} onChange={(ev) => onChange(ev.target.value)} />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">Where everyone stands when the register starts. For weekly-off staff give the day of their last off: every day after it counts as duty, so the app knows their Day N and the offs they are owed. Leave a row alone to start them fresh.</p>
      <label className="block max-w-xs">
        <span className="mb-1 block text-sm font-medium text-slate-700">As on the end of</span>
        <input type="date" className={inputClass} value={asOn} max={today} onChange={(ev) => ev.target.value && setAsOn(ev.target.value)} />
        <span className="mt-1 block text-footnote text-slate-500">Counting goes on from the next day.</span>
      </label>

      {weekly.length > 0 && (
        <section>
          <h3 className="mb-1 text-footnote font-semibold text-slate-600">Weekly off</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {weekly.map((e) => {
              const r = rows[e.id]!;
              const f = figures(r);
              const st = offStatus(f, settings);
              const fresh = !r.touched && started.get(e.id) === false;
              return (
                <li key={e.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 text-sm font-medium text-ink [overflow-wrap:anywhere]">
                      {e.name}
                      {!r.touched && started.get(e.id) && <span className="ml-1.5 text-footnote font-normal text-slate-500">(has a starting point; kept unless changed)</span>}
                    </span>
                    {(r.touched || fresh) && !bad(r) && (
                      <span className={cx("rounded-full px-2 py-0.5 text-footnote font-medium whitespace-nowrap", TONE[TONE_OF[st.tone]].soft)}>
                        Day {f.run} · {st.text}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="block min-w-0">
                      <span className="block text-caption text-slate-500">Last off on</span>
                      <input type="date" max={asOn} className={cx(inputClass, "mt-0.5 w-full")} value={r.lastOff} onChange={(ev) => set(e.id, { lastOff: ev.target.value, days: "" })} />
                    </label>
                    {numberBox("or days since it", r.lastOff ? "" : r.days, (v) => set(e.id, { days: v, lastOff: "" }), "1", 0)}
                    {numberBox("Offs owed from before", r.extra, (v) => set(e.id, { extra: v }))}
                    {numberBox("CL taken this year", r.cl, (v) => set(e.id, { cl: v }), "0.5", 0)}
                  </div>
                  {r.lastOff && r.lastOff > asOn && <p className="text-footnote text-urgent-ink">The last off must be on or before {dayLabel(asOn)}.</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sunday.length > 0 && (
        <section>
          <h3 className="mb-1 text-footnote font-semibold text-slate-600">Sunday off (only casual leave to start)</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {sunday.map((e) => (
              <li key={e.id} className="flex flex-wrap items-end gap-x-3 gap-y-1 p-3">
                <span className="min-w-0 flex-1 basis-48 self-center text-sm text-ink [overflow-wrap:anywhere]">{e.name}</span>
                <div className="w-36">{numberBox("CL taken this year", rows[e.id]!.cl, (v) => set(e.id, { cl: v }), "0.5", 0)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {people.length === 0 && <p className="text-sm text-slate-500">Nobody is in the office on {dayLabel(asOn)}.</p>}
      <p className="text-footnote text-slate-500">Holidays worked with CH still to take are added one person at a time in Settings › Attendance › Starting figures.</p>
      <ErrorNote error={start.error} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-footnote text-slate-500">{sent.length === 0 ? "Nothing changed yet" : `${sent.length} ${sent.length === 1 ? "person" : "people"} will be saved`}</span>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={sent.length === 0 || invalid || start.isPending}>
          <Check size={15} /> Save
        </Button>
      </div>
    </form>
  );
}
