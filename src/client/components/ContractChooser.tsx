// Contract ending (user request 2026-10-08): a temporary employee's "Contract ends" task (made by the system 7
// days before the end date) isn't simply ticked. Ticking it anywhere (Due Today, To-do, the Tasks page, Task
// details) or swiping it right on a phone asks: Renew for the contract period again, from the day after it ends,
// or Contract ended (left the office on the end date). Either one completes the task, with Undo. On wider
// screens the choice is a small menu growing out of the tapped tick; on phones (and after a swipe) an action
// sheet. Opened from anywhere with openContract(task); it lives once in the app shell (ContractChooserHost).
import { CalendarX2, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { ContractEnding, Task } from "../../shared/types";
import { renewedEnd } from "../../shared/staff";
import { useContractAction, useMe, useStaff } from "../api";
import { formatDay } from "../format";
import { AnchoredMenu } from "./RemoveChooser";
import { usePhone } from "./sheet";
import { showUndo } from "./SwipeRow";
import { ActionSheet, ErrorNote, Spinner, cx } from "./ui";

export const isContractTask = (task: Task) => task.systemKind === "contract" && task.status === "open";

// The button last pressed, so the menu can grow out of the tick that opened it whichever row it was in.
let lastPressed: HTMLElement | null = null;
if (typeof document !== "undefined")
  document.addEventListener("pointerdown", (e) => (lastPressed = (e.target as Element | null)?.closest?.("button") ?? null), true);

type Request = { task: Task; anchor: HTMLElement | null; after?: () => void };
let opener: ((r: Request) => void) | null = null;
export const openContract = (task: Task, after?: () => void) => opener?.({ task, anchor: lastPressed, after });

export function ContractChooserHost() {
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
    ? { employeeId: task.relatedId, name: e?.name ?? task.title.replace(/^Contract ends:\s*/, ""), designation, end: e?.engagedTill ?? task.dueDate ?? today, days: e?.contractDays ?? null }
    : null;
  const title = `Contract of ${item?.name ?? task.title}`;
  const body = !item ? (
    <p className="px-3 py-2 text-footnote text-slate-500">This task isn't linked to an employee any more.</p>
  ) : staff.isLoading ? (
    <div className="flex justify-center py-3">
      <Spinner size={18} />
    </div>
  ) : (
    <ContractChoices
      key={task.id}
      item={item}
      today={today}
      onDone={() => {
        close();
        req.after?.();
      }}
    />
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
