// Joining & relieving (user request 2026-10-15): the Employees page card with the summary tables (Joined, Relieved),
// one row per person and a Pending / Waiting / Done pill per step, like the user's spreadsheet; and the Join /
// Relieve form. A pill writes the step of the person's joining / relieving task, and ticking the step in the task
// changes the pill: they are the same data (src/shared/moves.ts). Finished ones (task completed) are behind
// "Show finished".
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ChevronDown, UserMinus, UserPlus, UsersRound } from "lucide-react";
import type { StaffList, StaffMove } from "../../shared/types";
import { MOVE_STEPS, type MoveKind, type MoveStep, type StepState } from "../../shared/moves";
import { useMe, useMoveActions, useMoves, useStaff } from "../api";
import { EmployeeDialog } from "../pages/Staff";
import { Button, Card, ErrorNote, Field, Modal, Segmented, SkeletonList, TONE, cx, inputClass } from "./ui";

const fullDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STATE_TONE = { pending: TONE.urgent.soft, waiting: TONE.medium.soft, done: TONE.low.soft } as const;
const stateLabel = (step: MoveStep, state: StepState) => (state === "done" ? step.doneLabel : state === "waiting" ? "Waiting" : "Pending");

// Opens the card's Join / Relieve form from elsewhere on the page (the phones' + button, user request 2026-10-16).
let opener: ((kind: MoveKind) => void) | null = null;
export const openMoveForm = (kind: MoveKind) => opener?.(kind);

export function MovesCard({ staff }: { staff: StaffList }) {
  const { data } = useMoves();
  const [kind, setKind] = useState<MoveKind>("join");
  const [showFinished, setShowFinished] = useState(false);
  const [form, setForm] = useState<MoveKind | null>(null);
  useEffect(() => {
    opener = setForm;
    return () => {
      opener = null;
    };
  }, []);
  const all = data?.moves ?? [];
  const open = (k: MoveKind) => all.filter((m) => m.kind === k && !m.finished).length;
  const list = all.filter((m) => m.kind === kind && (showFinished || !m.finished));
  const finished = all.filter((m) => m.kind === kind && m.finished).length;
  const steps = MOVE_STEPS[kind];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5">
        <h2 className="flex flex-1 items-center gap-2 font-semibold text-ink">
          <UsersRound size={17} className="text-brand-700" /> Joining &amp; relieving
        </h2>
        <Button size="sm" onClick={() => setForm("join")}>
          <UserPlus size={15} /> Join
        </Button>
        <Button size="sm" onClick={() => setForm("relieve")}>
          <UserMinus size={15} /> Relieve
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3 sm:px-5">
        <Segmented<MoveKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: "join", label: "Joined", count: open("join") },
            { value: "relieve", label: "Relieved", count: open("relieve") },
          ]}
        />
        {finished > 0 && (
          <label className="ml-auto flex items-center gap-2 text-footnote text-slate-600">
            <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} className="size-4 accent-brand-600" />
            Show finished ({finished})
          </label>
        )}
      </div>

      {!data ? (
        <SkeletonList rows={2} />
      ) : list.length === 0 ? (
        <p className="px-4 py-5 text-sm text-slate-500 sm:px-5">
          {kind === "join" ? "No one joining at the moment." : "No one being relieved at the moment."} Use {kind === "join" ? "Join" : "Relieve"} to start the steps for someone.
        </p>
      ) : (
        <>
          {/* Computers and tablets: the table, a column per step. */}
          <div className="mt-3 overflow-x-auto max-md:hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line bg-canvas-soft text-left text-caption font-medium text-slate-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Name</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">{kind === "join" ? "Joined" : "Relieved"}</th>
                  {steps.map((s) => (
                    <th key={s.id} className="px-2 py-2 font-medium">
                      {s.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((m) => (
                  <tr key={m.id} className={cx("align-middle", m.finished && "opacity-60")}>
                    <td className="px-4 py-2 sm:px-5">
                      <Person move={m} />
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-slate-600 tabular-nums">{fullDate(m.onDate)}</td>
                    {steps.map((s) => (
                      <td key={s.id} className="px-2 py-2">
                        <StepPill move={m} step={s} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phones: each person with their steps under them. */}
          <ul className="mt-3 divide-y divide-line border-t border-line md:hidden">
            {list.map((m) => (
              <li key={m.id} className={cx("px-3 py-2.5", m.finished && "opacity-60")}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <Person move={m} />
                  <span className="ml-auto shrink-0 text-footnote text-slate-500 tabular-nums">{fullDate(m.onDate)}</span>
                </div>
                <div className="space-y-1">
                  {steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-footnote text-slate-600">{s.text}</span>
                      <StepPill move={m} step={s} />
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <MoveDialog kind={form} staff={staff} onClose={() => setForm(null)} />
    </Card>
  );
}

function Person({ move: m }: { move: StaffMove }) {
  return (
    <span className="min-w-0">
      <Link to={`/employees/${m.employeeId}`} className="font-medium text-ink [overflow-wrap:anywhere] hover:text-brand-700 hover:underline">
        {m.name}
      </Link>
      {m.designation && <span className="block text-caption text-slate-500">{m.designation}</span>}
      {m.finished && <span className="block text-caption font-medium text-low-ink">{m.taskId ? "All done" : "Task deleted"}</span>}
    </span>
  );
}

// The coloured drop-down of one step (Pending red, Waiting yellow, Done / Received green), as in the spreadsheet.
function StepPill({ move: m, step }: { move: StaffMove; step: MoveStep }) {
  const { step: setStep } = useMoveActions();
  const state = m.steps.find((s) => s.id === step.id)?.state ?? null;
  if (!m.taskId) return <span className="text-slate-400">—</span>;
  const value = state ?? "pending";
  return (
    <span className={cx("relative inline-flex min-w-28 items-center rounded-full", STATE_TONE[value], state === null && "opacity-60")}>
      <select
        value={value}
        onChange={(e) => setStep.mutate({ id: m.id, step: step.id, state: e.target.value as StepState })}
        aria-label={`${step.text}: ${m.name}`}
        className="h-7 w-full cursor-pointer appearance-none rounded-full bg-transparent py-0 pr-7 pl-3 text-footnote font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-300 pointer-coarse:h-8"
      >
        {(["pending", "waiting", "done"] as const).map((s) => (
          <option key={s} value={s}>
            {stateLabel(step, s)}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5" aria-hidden />
    </span>
  );
}

// Join or relieve someone. Join: anyone (someone who left comes back), or a new employee added here first.
// Relieve: someone still in the office; they are marked Left the office on that date.
export function MoveDialog({ kind, staff, employeeId, onClose }: { kind: MoveKind | null; staff: StaffList; employeeId?: string; onClose: () => void }) {
  return (
    <Modal open={kind !== null} onClose={onClose} title={kind === "relieve" ? "Relieve an employee" : "Join an employee"}>
      {kind && <MoveForm key={kind + (employeeId ?? "")} kind={kind} staff={staff} employeeId={employeeId} onDone={onClose} />}
    </Modal>
  );
}

function MoveForm({ kind, staff, employeeId, onDone }: { kind: MoveKind; staff: StaffList; employeeId?: string; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { start } = useMoveActions();
  const [who, setWho] = useState(employeeId ?? "");
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState(false);
  const people = staff.employees.filter((e) => (kind === "relieve" ? !e.leftOn : true));
  const groups = [
    ...staff.designations.map((d) => ({ label: d.name, list: people.filter((e) => e.designationId === d.id) })),
    { label: "No designation", list: people.filter((e) => !e.designationId || !staff.designations.some((d) => d.id === e.designationId)) },
  ]
    .map((g) => ({ ...g, list: [...g.list].sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.list.length);
  const chosen = staff.employees.find((e) => e.id === who);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!who) return;
    try {
      await start.mutateAsync({ employeeId: who, kind, date });
      onDone();
    } catch {
      // shown under the form
    }
  };

  return (
    <>
    <form onSubmit={submit} className="space-y-4">
      <Field label={kind === "join" ? "Who is joining" : "Who is being relieved"}>
        <select
          className={inputClass}
          value={who}
          onChange={(e) => (e.target.value === "+new" ? setAdding(true) : setWho(e.target.value))}
          required
          disabled={!!employeeId}
        >
          <option value="">Choose an employee…</option>
          {kind === "join" && <option value="+new">+ Add a new employee…</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.list.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.leftOn ? " (left)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label={kind === "join" ? "Joining date" : "Relieving date"}>
        <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <p className="rounded-md bg-slate-50 px-3 py-2 text-footnote text-slate-600">
        {kind === "join"
          ? `Makes a task with the joining steps (${MOVE_STEPS.join.map((s) => s.text.toLowerCase()).join(", ")}).${chosen?.leftOn ? " They are back in the office from this date." : ""}`
          : `They are marked "Left the office" on this date, and a task is made with the relieving steps (${MOVE_STEPS.relieve.map((s) => s.text.toLowerCase()).join(", ")}).`}
      </p>
      <ErrorNote error={start.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!who || start.isPending}>
          {kind === "join" ? <UserPlus size={16} /> : <UserMinus size={16} />} {kind === "join" ? "Join" : "Relieve"}
        </Button>
      </div>
    </form>
    {/* Outside the form above: a form can't sit inside another. */}
    <EmployeeDialog open={adding} employee={null} staff={staff} onClose={() => setAdding(false)} onAdded={setWho} />
    </>
  );
}

// Settings › Employees (user request 2026-10-16): put someone already working here, whose joining procedure isn't
// complete, into the joining process. Lists employees still in the office with no joining record; the date starts
// as their "Joined this office" date; steps already done are ticked so only the rest stay pending.
export function JoinExistingCard() {
  const { data: staff } = useStaff();
  const { data } = useMoves();
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { start } = useMoveActions();
  const [who, setWho] = useState("");
  const [date, setDate] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const joined = new Set((data?.moves ?? []).filter((m) => m.kind === "join").map((m) => m.employeeId));
  const people = (staff?.employees ?? []).filter((e) => !e.leftOn && !joined.has(e.id));
  const groups = [
    ...(staff?.designations ?? []).map((d) => ({ label: d.name, list: people.filter((e) => e.designationId === d.id) })),
    { label: "No designation", list: people.filter((e) => !e.designationId || !staff?.designations.some((d) => d.id === e.designationId)) },
  ]
    .map((g) => ({ ...g, list: [...g.list].sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.list.length);
  const pick = (id: string) => {
    setWho(id);
    setAdded(null);
    setDate(staff?.employees.find((e) => e.id === id)?.joinedOfficeOn ?? today);
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!who) return;
    const name = staff?.employees.find((e) => e.id === who)?.name ?? "";
    try {
      await start.mutateAsync({ employeeId: who, kind: "join", date: date || today, doneSteps: done });
      setWho("");
      setDate("");
      setDone([]);
      setAdded(name);
    } catch {
      // shown below
    }
  };

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <UserPlus size={18} className="text-brand-700" /> Joining procedure for current staff
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        For someone already working here whose joining paperwork isn't complete: they get the joining task and a row in Joining &amp; relieving on the Employees page.
      </p>
      {!staff || !data ? (
        <SkeletonList rows={1} />
      ) : people.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Everyone in the office already has a joining record.</p>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Employee">
              <select className={inputClass} value={who} onChange={(e) => pick(e.target.value)} required>
                <option value="">Choose an employee…</option>
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
            </Field>
            <Field label="Joining date">
              <input type="date" className={inputClass} value={date || today} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Already done</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {MOVE_STEPS.join.map((s) => (
                <label key={s.id} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={done.includes(s.id)}
                    onChange={(e) => setDone((d) => (e.target.checked ? [...d, s.id] : d.filter((x) => x !== s.id)))}
                    className="size-4 accent-brand-600"
                  />
                  {s.text}
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorNote error={start.error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={!who || start.isPending}>
              <UserPlus size={16} /> Add to joining process
            </Button>
          </div>
        </form>
      )}
      {added && (
        <p className="mt-2 text-footnote text-low-ink">
          {added} added to the joining process.{" "}
          <Link to="/employees" className="font-medium text-brand-700 hover:underline">
            See the table
          </Link>
        </p>
      )}
    </Card>
  );
}
