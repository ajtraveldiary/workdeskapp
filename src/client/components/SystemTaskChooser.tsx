// System tasks that ask instead of being ticked (user requests 2026-10-08). Ticking one anywhere (Due Today,
// To-do, the Tasks page, Task details) or swiping it right on a phone opens a choice:
// - "Contract ends" (a temporary employee's contract, made 7 days before the end date): Renew for the contract
//   period again, from the day after it ends, or Contract ended (left the office on the end date).
// - "Probation declaration" (2 years of service, probation not declared): Probation declared (today), or
//   Change due date (probation extended, e.g. by leave).
// The first choice of each completes the task, with Undo; changing the date keeps it open, with Undo. On wider
// screens the choice is a small menu growing out of the tapped tick; on phones (and after a swipe) an action
// sheet. Opened from anywhere with openTaskChoice(task); it lives once in the app shell (SystemTaskChooserHost).
import { BadgeCheck, CalendarClock, CalendarX2, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { ContractEnding, Task } from "../../shared/types";
import { renewedEnd } from "../../shared/staff";
import { useContractAction, useMe, useProbationAction, useStaff, useUpdateTask } from "../api";
import { formatDay } from "../format";
import { AnchoredMenu } from "./RemoveChooser";
import { usePhone } from "./sheet";
import { showUndo } from "./SwipeRow";
import { ActionSheet, Button, ErrorNote, Spinner, cx, inputClass } from "./ui";

// Open system tasks whose tick asks instead of completing: "Contract ends" and "Probation declaration".
export const asksChoice = (task: Task) => (task.systemKind === "contract" || task.systemKind === "probation") && task.status === "open";
// The swipe action / Task details button for one ("Contract", "Probation").
export const choiceLabel = (task: Task) => (task.systemKind === "probation" ? "Probation" : "Contract");

// The button last pressed, so the menu can grow out of the tick that opened it whichever row it was in.
let lastPressed: HTMLElement | null = null;
if (typeof document !== "undefined")
  document.addEventListener("pointerdown", (e) => (lastPressed = (e.target as Element | null)?.closest?.("button") ?? null), true);

type Request = { task: Task; anchor: HTMLElement | null; after?: () => void };
let opener: ((r: Request) => void) | null = null;
export const openTaskChoice = (task: Task, after?: () => void) => opener?.({ task, anchor: lastPressed, after });

export function SystemTaskChooserHost() {
  const [req, setReq] = useState<Request | null>(null);
  const phone = usePhone();
  const staff = useStaff();
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  useEffect(() => {
    opener = setReq;
    return () => {
      opener = null;
    };
  }, []);
  if (!req) return null;
  const close = () => setReq(null);
  const { task } = req;
  const e = staff.data?.employees.find((x) => x.id === task.relatedId);
  const designation = staff.data?.designations.find((d) => d.id === e?.designationId)?.name ?? null;
  const item: ContractEnding | null = task.relatedId
    ? { employeeId: task.relatedId, name: e?.name ?? task.title.replace(/^[^:]*:\s*/, ""), designation, end: e?.engagedTill ?? task.dueDate ?? today, days: e?.contractDays ?? null }
    : null;
  const probation = task.systemKind === "probation";
  const title = `${probation ? "Probation" : "Contract"} of ${item?.name ?? task.title.replace(/^[^:]*:\s*/, "")}`;
  const done = () => {
    close();
    req.after?.();
  };
  const body = !item ? (
    <p className="px-3 py-2 text-footnote text-slate-500">This task isn't linked to an employee any more.</p>
  ) : staff.isLoading ? (
    <div className="flex justify-center py-3">
      <Spinner size={18} />
    </div>
  ) : probation ? (
    <ProbationChoices key={task.id} task={task} employeeId={item.employeeId} name={item.name} today={today} onDone={done} />
  ) : (
    <ContractChoices key={task.id} item={item} today={today} onDone={done} />
  );
  // Phones, and a swipe (its button is gone once tapped): a compact action sheet.
  if (phone || !req.anchor?.isConnected)
    return createPortal(
      <ActionSheet onClose={close} title={title}>
        {body}
      </ActionSheet>,
      document.body,
    );
  return (
    <AnchoredMenu key={task.id} anchor={req.anchor} onClose={close} label={title}>
      {body}
    </AnchoredMenu>
  );
}

function ContractChoices({ item, today, onDone }: { item: ContractEnding; today: string; onDone: () => void }) {
  const act = useContractAction();
  const navigate = useNavigate();
  const rowClass = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:opacity-50 pointer-coarse:py-2.5";
  const openEmployee = () => {
    onDone();
    navigate(`/employees?employee=${item.employeeId}`);
  };
  // mutateAsync, not mutate's callbacks: the task's row (and this menu) is gone once the lists reload.
  const renew = () =>
    act
      .mutateAsync({ id: item.employeeId, action: "renew" })
      .then((r) => {
        onDone();
        showUndo({
          message: `Contract renewed: ${item.name}${r.next ? ` · ends ${formatDay(r.next, today)}` : ""}`,
          onUndo: () => r.previous && act.mutate({ id: item.employeeId, action: "renew", undoTo: r.previous }),
        });
      })
      .catch(() => {});
  const ended = () =>
    act
      .mutateAsync({ id: item.employeeId, action: "ended" })
      .then(() => {
        onDone();
        showUndo({ message: `Contract ended: ${item.name} left the office`, onUndo: () => act.mutate({ id: item.employeeId, action: "ended", undo: true }) });
      })
      .catch(() => {});
  return (
    <div className="p-1">
      {item.days ? (
        <button type="button" onClick={renew} disabled={act.isPending} className={rowClass}>
          <RefreshCw size={16} className="shrink-0 text-brand-700" />
          <span className="min-w-0 flex-1">
            Renew for {item.days} days
            <span className="block text-caption text-slate-500">Ends {formatDay(renewedEnd(item.end, item.days), today)}</span>
          </span>
          {act.isPending && act.variables?.action === "renew" && <Spinner size={14} />}
        </button>
      ) : (
        <button type="button" onClick={openEmployee} className={rowClass}>
          <RefreshCw size={16} className="shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            Renew
            <span className="block text-caption text-slate-500">No contract period set: open the employee to set it or a new end date</span>
          </span>
        </button>
      )}
      <button type="button" onClick={ended} disabled={act.isPending} className={cx(rowClass, "text-urgent-ink")}>
        <CalendarX2 size={16} className="shrink-0" />
        <span className="min-w-0 flex-1">
          Contract ended
          <span className="block text-caption text-slate-500">Left the office on {formatDay(item.end, today)}</span>
        </span>
        {act.isPending && act.variables?.action === "ended" && <Spinner size={14} />}
      </button>
      <button type="button" onClick={openEmployee} className={rowClass}>
        <UserRound size={16} className="shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Open {item.name}</span>
      </button>
      {act.error ? (
        <div className="px-1 pt-1">
          <ErrorNote error={act.error} />
        </div>
      ) : null}
    </div>
  );
}

// Probation declaration (user request 2026-10-08): Probation declared records today's date on the employee and
// completes the task; Change due date moves the task (probation extended, e.g. by leave) and keeps it open.
function ProbationChoices({ task, employeeId, name, today, onDone }: { task: Task; employeeId: string; name: string; today: string; onDone: () => void }) {
  const act = useProbationAction();
  const update = useUpdateTask();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const current = task.dueDate ?? today;
  const [date, setDate] = useState(current);
  const rowClass = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:opacity-50 pointer-coarse:py-2.5";
  const declared = () =>
    act
      .mutateAsync({ id: employeeId })
      .then((r) => {
        onDone();
        showUndo({ message: `Probation declared: ${name}`, onUndo: () => r.declaredOn && act.mutate({ id: employeeId, undo: true, declaredOn: r.declaredOn }) });
      })
      .catch(() => {});
  const move = (to: string) =>
    update
      .mutateAsync({ id: task.id, input: { dueDate: to } })
      .then(() => {
        onDone();
        showUndo({ message: `Probation of ${name}: due ${formatDay(to, today)}`, onUndo: () => update.mutate({ id: task.id, input: { dueDate: current } }) });
      })
      .catch(() => {});
  // Probation extended: a month, three or six from the current due date.
  const plusMonths = (n: number) => {
    const d = new Date(`${current}T00:00:00Z`);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  };
  if (picking)
    return (
      <form
        className="space-y-2 p-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (date && date !== current) void move(date);
        }}
      >
        <p className="text-caption font-medium text-slate-500">New due date · now {formatDay(current, today)}</p>
        <div className="flex flex-wrap gap-2">
          {[1, 3, 6].map((n) => (
            <Button key={n} type="button" size="sm" onClick={() => setDate(plusMonths(n))} disabled={update.isPending}>
              +{n} month{n === 1 ? "" : "s"}
            </Button>
          ))}
        </div>
        <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} aria-label="New due date" />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>
            Back
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={!date || date === current || update.isPending}>
            {update.isPending ? <Spinner size={14} /> : null} Save date
          </Button>
        </div>
        <ErrorNote error={update.error} />
      </form>
    );
  return (
    <div className="p-1">
      <button type="button" onClick={declared} disabled={act.isPending} className={rowClass}>
        <BadgeCheck size={16} className="shrink-0 text-low-ink" />
        <span className="min-w-0 flex-1">
          Probation declared
          <span className="block text-caption text-slate-500">Records today, {new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, as the date</span>
        </span>
        {act.isPending && <Spinner size={14} />}
      </button>
      <button type="button" onClick={() => setPicking(true)} className={rowClass}>
        <CalendarClock size={16} className="shrink-0 text-brand-700" />
        <span className="min-w-0 flex-1">
          Change due date
          <span className="block text-caption text-slate-500">Probation extended, e.g. by leave · now {formatDay(current, today)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          onDone();
          navigate(`/employees?employee=${employeeId}`);
        }}
        className={rowClass}
      >
        <UserRound size={16} className="shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Open {name}</span>
      </button>
      {act.error ? (
        <div className="px-1 pt-1">
          <ErrorNote error={act.error} />
        </div>
      ) : null}
    </div>
  );
}
