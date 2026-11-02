// The Offs board (user request 2026-11-02, "attendance is mainly for reminding staff to take an off in 6 days, or the
// off and a compensatory off after 12 days without a break"; docs/ATTENDANCE_UX_PLAN.md phase 1): the Attendance page's
// first tab. A card per weekly-off person, the most urgent first: Day N (days of duty in a row) and a coloured status
// (offStatus: off after n more days / off due / overdue / off + compensatory off owed), the last 14 days as a strip, the
// last off, and Off today. Tapping a card opens the person sheet: the figures in plain words, CL / CH this year, the
// holidays worked with CH to take, Off today, Correct the count (days in a row and offs owed with − / +, a note; saved
// as a correction dated today, with Undo) and the corrections made, each with Take back. Phase 2: people with no
// starting point yet show "No starting point" (and are left out of the counts) with a banner to Start the register;
// days not marked count as duty (a faint ✓ in the strip) while that setting is on.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CalendarClock, Check, Minus, Play, Plus, SlidersHorizontal, TableProperties } from "lucide-react";
import { openStartRegister } from "./StartRegister";
import type { OffsBoard as Board, OffsBoardDay, OffsBoardPerson } from "../../shared/types";
import { MARK_NAME, dutyForOff, offStatus, type OffTone } from "../../shared/attendance";
import { dayLabel } from "../../shared/reminderSchedule";
import { useAttendanceActions, useOffsBoard } from "../api";
import { RefreshButton } from "./RefreshButton";
import { showUndo } from "./SwipeRow";
import { Button, Card, ErrorNote, Modal, SkeletonList, TONE, cx, inputClass, type Tone } from "./ui";

const TONE_OF: Record<OffTone, Tone> = { red: "urgent", orange: "high", amber: "medium", blue: "info", grey: "neutral" };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shortDay = (d: string) => `${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${dayLabel(d).replace(/ \d{4}$/, "")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function OffsBoard({ onRegister }: { onRegister: () => void }) {
  const { data, error } = useOffsBoard();
  const [openId, setOpenId] = useState<string | null>(null);
  const people = useMemo(() => {
    if (!data) return [];
    return data.people
      .map((p) => ({ p, st: offStatus(p, data) }))
      // Those with a starting point by urgency, then those without one.
      .sort((a, b) => Number(b.p.started) - Number(a.p.started) || b.st.rank - a.st.rank || b.p.run - a.p.run || a.p.name.localeCompare(b.p.name));
  }, [data]);
  const open = people.find((x) => x.p.id === openId);
  const counted = people.filter((x) => x.p.started);
  const due = counted.filter((x) => x.st.owed >= 1 || x.st.tone === "red").length;
  const long = counted.filter((x) => x.p.run > (data?.maxRun ?? 12)).length;
  const unstarted = people.length - counted.length;

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-subhead text-ink sm:text-sm">
          {!data ? (
            "Weekly off"
          ) : people.length === 0 ? (
            "No one on weekly off"
          ) : due === 0 ? (
            <span className="text-low-ink">No one needs an off today</span>
          ) : (
            <>
              <span className="font-semibold text-urgent-ink">{plural(due, "person needs", "people need")} an off</span>
              {long > 0 && <span className="text-slate-500"> · {long} past {data.maxRun} days in a row</span>}
            </>
          )}
        </p>
        {people.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => openStartRegister()} aria-label="Starting points: start the register">
            <Play size={15} /> <span className="hidden sm:inline">Starting points</span>
          </Button>
        )}
        <RefreshButton keys={[["attendance"]]} label="Refresh the offs" />
      </div>
      <ErrorNote error={error} />
      {unstarted > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-tint px-3 py-2.5">
          <p className="min-w-0 flex-1 basis-56 text-sm text-ink">
            {plural(unstarted, "person on weekly off has", "people on weekly off have")} no starting point yet. Give the day of each one's last off and the count is right from today.
          </p>
          <Button size="sm" variant="primary" onClick={() => openStartRegister()}>
            <Play size={15} /> Start the register
          </Button>
        </div>
      )}
      {!data ? (
        <SkeletonList rows={4} />
      ) : people.length === 0 ? (
        <Card className="p-5 text-sm text-slate-600">
          <p>Nobody here is on weekly off. Give someone "Day off: Weekly off" on their employee page (Edit) and their offs are counted here.</p>
          <Button size="sm" className="mt-3" onClick={onRegister}>
            <TableProperties size={15} /> Open the register
          </Button>
        </Card>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {people.map(({ p, st }) => (
            <OffCard key={p.id} p={p} board={data} tone={st.tone} text={st.text} early={st.early} onOpen={() => setOpenId(p.id)} />
          ))}
        </ul>
      )}
      {data && data.sundayOff > 0 && people.length > 0 && (
        <p className="mt-3 text-footnote text-slate-500">
          {plural(data.sundayOff, "person has", "people have")} Sundays off and {data.sundayOff === 1 ? "isn't" : "aren't"} listed. 6 days of duty, CL, CH or a holiday not worked earn an off.
        </p>
      )}
      {data && (
        <Modal open={!!open} onClose={() => setOpenId(null)} title={open?.p.name ?? ""} closeOnBackdrop>
          {open && <PersonSheet p={open.p} board={data} onRegister={onRegister} />}
        </Modal>
      )}
    </>
  );
}

function StatusPill({ tone, text }: { tone: OffTone; text: string }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-footnote font-medium whitespace-nowrap", TONE[TONE_OF[tone]].soft)}>{text}</span>;
}

function OffCard({ p, board, tone, text, early, onOpen }: { p: OffsBoardPerson; board: Board; tone: OffTone; text: string; early: number; onOpen: () => void }) {
  return (
    <li className={cx("row-click relative flex flex-col gap-2 rounded-xl border bg-white p-3 has-[:is(button,a):hover]:bg-slate-50/80", tone === "red" ? "border-urgent/40" : "border-line")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="row-link text-left text-subhead leading-snug font-semibold text-ink [overflow-wrap:anywhere] hover:text-brand-700 sm:text-sm">
            {p.name}
          </button>
          {p.designation && <p className="truncate text-footnote text-slate-500">{p.designation}</p>}
        </div>
        {p.started && <DayNumber run={p.run} tone={tone} />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {p.started ? <StatusPill tone={tone} text={text} /> : <StatusPill tone="grey" text="No starting point" />}
        {p.started && early > 0 && <span className="text-footnote text-slate-500">{plural(early, "off")} taken early</span>}
      </div>
      <Strip days={p.days} today={board.today} assume={board.assumeDuty && p.started} />
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-footnote text-slate-500">{p.lastOff ? `Last off ${shortDay(p.lastOff)}` : "No off marked yet"}</p>
        <OffToday p={p} board={board} />
      </div>
    </li>
  );
}

function DayNumber({ run, tone }: { run: number; tone: OffTone }) {
  return (
    <div className="shrink-0 text-right leading-none" aria-label={`${run} days of duty in a row`}>
      <span className={cx("text-title2 font-semibold", tone === "red" ? "text-urgent-ink" : tone === "orange" ? "text-high-ink" : "text-ink")}>Day {run}</span>
      <span className="mt-0.5 block text-caption2 text-slate-500">in a row</span>
    </div>
  );
}

// The last 14 days, oldest first, today outlined: ✓ duty (a dot when on a holiday), O off, CL / ½ / CH, A absent, the
// leave's short name, H a holiday not worked, an empty box for a day not marked, nothing outside the office.
function Strip({ days, today, assume }: { days: OffsBoardDay[]; today: string; assume: boolean }) {
  return (
    <div>
      <ol className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-0.5" aria-label="The last 14 days">
        {days.map((d) => {
          const look = dayLook(d, assume && d.date < today);
          return (
            <li
              key={d.date}
              title={`${shortDay(d.date)}: ${look.words}`}
              aria-label={`${shortDay(d.date)}: ${look.words}`}
              className={cx("relative flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded text-caption2 leading-none font-semibold", look.cls, d.date === today && "ring-2 ring-brand-500 ring-offset-1 ring-offset-white")}
            >
              {look.text}
              {d.mark === "present" && d.holiday && <span className="absolute top-0.5 right-0.5 size-1 rounded-full bg-info" aria-hidden />}
            </li>
          );
        })}
      </ol>
      <div className="mt-0.5 flex justify-between text-caption2 text-slate-400" aria-hidden>
        <span>{shortDay(days[0]!.date)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}
// assumed: a past day not marked counts as duty (Count days not marked as duty).
function dayLook(d: OffsBoardDay, assumed: boolean): { text: string; cls: string; words: string } {
  if (d.out) return { text: "", cls: "bg-slate-50", words: "not in the office" };
  // Short names that fit a square (EL); longer ones (HPL, Commuted) as L, named in the words.
  if (d.leave) return { text: d.leave.length <= 2 ? d.leave : "L", cls: "bg-snooze-soft text-snooze-ink", words: `leave (${d.leave})` };
  switch (d.mark) {
    case "present":
      return { text: "✓", cls: "bg-low-soft text-low-ink", words: d.holiday ? `holiday duty (${d.holiday})` : "duty" };
    case "off":
      return { text: "O", cls: "bg-brand-600 text-white", words: "weekly off" };
    case "cl":
      return { text: "CL", cls: "bg-high-soft text-high-ink", words: MARK_NAME.cl };
    case "cl_half":
      return { text: "½", cls: "bg-high-soft text-high-ink", words: MARK_NAME.cl_half };
    case "ch":
      return { text: "CH", cls: "bg-info-soft text-info-ink", words: MARK_NAME.ch };
    case "absent":
      return { text: "A", cls: "bg-urgent-soft text-urgent-ink", words: "absent" };
  }
  if (d.holiday) return { text: "H", cls: "bg-slate-100 text-slate-500", words: d.holiday };
  if (assumed) return { text: "✓", cls: "bg-low-soft/50 text-low-ink/50", words: "duty (not marked)" };
  return { text: "", cls: "border border-dashed border-slate-300", words: "not marked" };
}

// Off today: marks today's cell O (over a duty mark too), with Undo putting back what was there. Not offered on a
// holiday or leave, or over a CH (its holiday would be lost).
function OffToday({ p, board, wide }: { p: OffsBoardPerson; board: Board; wide?: boolean }) {
  const { mark, clear } = useAttendanceActions();
  const day = p.days.find((d) => d.date === board.today);
  if (!day || day.out || day.leave || day.holiday || day.mark === "ch") return null;
  if (day.mark === "off")
    return (
      <span className={cx("inline-flex items-center gap-1 text-footnote font-medium text-brand-700", wide && "h-9")}>
        <Check size={14} /> Off today
      </span>
    );
  const prev = day.mark;
  const early = dutyForOff(p.offsDue, p.towards, board.offEvery) > 0;
  const cells = [{ employeeId: p.id, date: board.today }];
  return (
    <Button
      size="sm"
      variant={early ? "secondary" : "primary"}
      disabled={mark.isPending}
      className={cx(wide && "flex-1")}
      onClick={(e) => {
        e.stopPropagation();
        mark.mutate(
          { cells, mark: "off", replace: true },
          {
            onSuccess: (r) =>
              showUndo({
                message: r.marked ? `Off today for ${p.name}${early ? " (taken early)" : ""}` : `Not marked: ${Object.keys(r.skipped).join(", ")}`,
                onUndo: r.marked ? () => (prev ? mark.mutate({ cells, mark: prev, replace: true }) : clear.mutate(cells)) : undefined,
              }),
          },
        );
      }}
    >
      Off today
    </Button>
  );
}

function PersonSheet({ p, board, onRegister }: { p: OffsBoardPerson; board: Board; onRegister: () => void }) {
  const [fixing, setFixing] = useState(false);
  const { uncorrect } = useAttendanceActions();
  const st = offStatus(p, board);
  const row = (label: string, value: ReactNode) => (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-36 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {p.designation && <p className="text-footnote text-slate-500">{p.designation}</p>}
          <StatusPill tone={st.tone} text={st.text} />
        </div>
        <DayNumber run={p.run} tone={st.tone} />
      </div>
      <Strip days={p.days} today={board.today} assume={board.assumeDuty && p.started} />
      {!p.started && (
        <p className="rounded-lg bg-tint px-3 py-2 text-sm text-ink">
          No starting point yet: the count below is only from what is marked.{" "}
          <button type="button" onClick={() => openStartRegister()} className="font-medium text-brand-700 hover:underline">
            Start the register
          </button>
        </p>
      )}
      <dl className="divide-y divide-line">
        {row("Days in a row", `${plural(p.run, "day")} of duty since the last off or leave`)}
        {row("Next off", st.owed >= 1 ? `${plural(st.owed, "off")} owed now${st.owed >= 2 ? " (the off and a compensatory off)" : ""}` : `After ${plural(st.need, "more day")} of duty`)}
        {st.early > 0 && row("Taken early", `${plural(st.early, "off")}, paid back by the next ${st.early === 1 ? "one" : "ones"} earned`)}
        {row("Carried over", `${p.towards} of ${board.offEvery} days towards the next off`)}
        {row("Last off", p.lastOff ? shortDay(p.lastOff) : "None marked yet")}
        {row("Casual leave", `${p.cl} of ${board.clPerYear} this year`)}
        {row("Compensation leave", `${p.ch} this year${p.chLimit === null ? " (no limit)" : ` of ${p.chLimit}`}`)}
        {p.chOpen.length > 0 &&
          row(
            "CH to take",
            <ul>
              {p.chOpen.map((o) => (
                <li key={o.holiday}>
                  {o.name} ({dayLabel(o.holiday)}), by {dayLabel(o.expires)}
                </li>
              ))}
            </ul>,
          )}
      </dl>
      {fixing ? (
        <CorrectCount p={p} board={board} onDone={() => setFixing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <OffToday p={p} board={board} wide />
          <Button size="sm" onClick={() => setFixing(true)} className="flex-1">
            <SlidersHorizontal size={15} /> Correct the count
          </Button>
          <Link to={`/markattendance?employee=${p.id}`} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-footnote font-medium whitespace-nowrap text-ink hover:bg-slate-50 active:scale-[0.97] pointer-coarse:h-9">
            <CalendarClock size={15} /> CL / CH / days
          </Link>
          <Button size="sm" variant="ghost" onClick={onRegister} className="flex-1">
            <TableProperties size={15} /> Register
          </Button>
        </div>
      )}
      {p.corrections.length > 0 && (
        <div>
          <h3 className="mb-1 text-footnote font-semibold text-slate-600">Corrections</h3>
          <ul className="divide-y divide-line">
            {p.corrections.map((c) => (
              <li key={c.id} className="flex items-start gap-2 py-1.5 text-footnote">
                <span className="min-w-0 flex-1 text-slate-600 [overflow-wrap:anywhere]">
                  {dayLabel(c.date)}: Day {c.run}, {c.offsDue > 0 ? `${plural(c.offsDue, "off")} owed` : c.offsDue < 0 ? `${plural(-c.offsDue, "off")} taken early` : "no off owed"}, {c.towards} towards the next
                  {c.note && <span className="text-slate-500"> · {c.note}</span>}
                </span>
                <Button size="sm" variant="ghost" disabled={uncorrect.isPending} onClick={() => uncorrect.mutate(c.id, { onSuccess: () => showUndo({ message: "Correction taken back" }) })}>
                  Take back
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-caption text-slate-500">A correction sets the count as on its day; marks before it no longer change it.</p>
        </div>
      )}
    </div>
  );
}

// Correct the count: days of duty in a row and offs owed, each with − / +. Changing the days moves the days carried
// towards the next off with them (6 more days add an off owed); offs owed can go below 0 (taken early).
function CorrectCount({ p, board, onDone }: { p: OffsBoardPerson; board: Board; onDone: () => void }) {
  const { correct, uncorrect } = useAttendanceActions();
  const every = board.offEvery;
  const [run, setRun] = useState(p.run);
  const [extra, setExtra] = useState(0);
  const [note, setNote] = useState("");
  // Days added or taken off the run count towards the next off as duty would.
  const counted = p.towards + (run - p.run);
  const towards = ((counted % every) + every) % every;
  const offsDue = p.offsDue + Math.floor(counted / every) + extra;
  const after = offStatus({ offsDue, towards, run }, board);
  const changed = run !== p.run || offsDue !== p.offsDue || towards !== p.towards;
  return (
    <form
      className="space-y-3 rounded-xl border border-line bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        correct.mutate(
          { employeeId: p.id, offsDue, towards, run, note },
          {
            onSuccess: (r) => {
              showUndo({ message: `Count of ${p.name} corrected`, onUndo: () => uncorrect.mutate(r.id) });
              onDone();
            },
          },
        );
      }}
    >
      <Stepper label="Days of duty in a row" value={run} min={0} max={90} onChange={setRun} />
      <Stepper
        label="Offs owed"
        value={offsDue}
        min={-10}
        max={20}
        onChange={(v) => setExtra(extra + (v - offsDue))}
        words={offsDue < 0 ? `${plural(-offsDue, "off")} taken early` : undefined}
      />
      <p className="text-footnote text-slate-600">
        Becomes: <StatusPill tone={after.tone} text={after.text} />
        {after.owed < 1 && <span> · {towards} of {every} days carried</span>}
      </p>
      <label className="block text-footnote text-slate-600">
        Note (optional)
        <input className={cx(inputClass, "mt-1")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. swapped with a colleague" />
      </label>
      <ErrorNote error={correct.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={!changed || correct.isPending}>
          Save the count
        </Button>
      </div>
    </form>
  );
}

function Stepper({ label, value, min, max, onChange, words }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; words?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-sm text-ink">
        {label}
        {words && <span className="block text-footnote text-slate-500">{words}</span>}
      </span>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label}: one less`} className="flex size-8 items-center justify-center rounded-lg border border-line bg-white text-ink enabled:hover:bg-slate-50 active:scale-90 disabled:opacity-50 pointer-coarse:size-9">
        <Minus size={15} />
      </button>
      <span className="w-8 text-center text-callout font-semibold text-ink tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`${label}: one more`} className="flex size-8 items-center justify-center rounded-lg border border-line bg-white text-ink enabled:hover:bg-slate-50 active:scale-90 disabled:opacity-50 pointer-coarse:size-9">
        <Plus size={15} />
      </button>
    </div>
  );
}
