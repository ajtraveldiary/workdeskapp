// One toolbar per email list instead of the same buttons on every email (user request 2026-10-06): tick
// emails, then Create task / Snooze / Dismiss (pending ones) or Restore (the others). One selected email
// opens the usual task form; several become tasks straight away, titled with their subjects.
import { useEffect, useRef, useState } from "react";
import { AlarmClock, ExternalLink, ListPlus, Undo2, X } from "lucide-react";
import type { Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useBulkDismiss, useBulkRestore, useBulkSnooze, useBulkTask } from "../api";
import { formatDateTime } from "../format";
import { showUndo } from "./SwipeRow";
import { snoozeOptions } from "./ThreadRow";
import { Button, PopPanel, cx } from "./ui";

export function EmailBulkBar({
  threads,
  selected,
  onSelectedChange,
  onCreateTask,
  className,
}: {
  threads: Thread[];
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  onCreateTask: (t: Thread) => void;
  className?: string;
}) {
  const bulkTask = useBulkTask();
  const bulkDismiss = useBulkDismiss();
  const bulkRestore = useBulkRestore();
  const busy = bulkTask.isPending || bulkDismiss.isPending || bulkRestore.isPending;
  if (threads.length === 0) return null;

  const picked = threads.filter((t) => selected.has(t.id));
  const pending = picked.filter((t) => t.state === "needs_decision");
  const others = picked.filter((t) => t.state !== "needs_decision");
  // Show only the actions this list can use; they stay disabled until something fitting is ticked.
  const listHasPending = threads.some((t) => t.state === "needs_decision");
  const listHasOthers = threads.some((t) => t.state !== "needs_decision");
  const all = picked.length === threads.length;
  const clear = () => onSelectedChange(new Set());
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const single = picked.length === 1 ? picked[0]! : null;
  const gmailUrl = single ? gmailThreadUrl(single.accountEmail, single.gmailThreadId) : null;

  const createTask = () => {
    if (pending.length === 1) return onCreateTask(pending[0]!);
    bulkTask.mutate(pending.map((t) => t.id), {
      onSuccess: (r) => {
        showUndo({ message: `${plural(r.created, "task")} created` });
        clear();
      },
    });
  };
  const dismiss = () =>
    bulkDismiss.mutate(pending.map((t) => t.id), {
      onSuccess: (r) => {
        showUndo({ message: `${plural(r.dismissed, "email")} dismissed` });
        clear();
      },
    });
  const restore = () =>
    bulkRestore.mutate(others.map((t) => t.id), {
      onSuccess: (r) => {
        showUndo({ message: `${plural(r.restored, "email")} back in Pending` });
        clear();
      },
    });

  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-1.5", className)}>
      <label className="mr-1 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          className="size-4 accent-brand-700 pointer-coarse:size-5"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = picked.length > 0 && !all;
          }}
          onChange={(e) => onSelectedChange(e.target.checked ? new Set(threads.map((t) => t.id)) : new Set())}
          aria-label="Select all emails"
        />
        <span className="tabular-nums">{picked.length ? `${picked.length} selected` : "Select all"}</span>
      </label>
      {listHasPending && (
        <>
          <Button size="sm" variant="primary" disabled={!pending.length || busy} onClick={createTask}>
            <ListPlus size={15} /> <span className="max-sm:hidden">Create task</span>
            <span className="sm:hidden">Task</span>
          </Button>
          <BulkSnooze ids={pending.map((t) => t.id)} disabled={!pending.length || busy} onDone={clear} />
          <Button size="sm" disabled={!pending.length || busy} onClick={dismiss} title="Remove from the queue. Gmail is not changed.">
            <X size={15} /> Dismiss
          </Button>
        </>
      )}
      {listHasOthers && (
        <Button size="sm" disabled={!others.length || busy} onClick={restore} title="Return to Pending">
          <Undo2 size={15} /> Restore
        </Button>
      )}
      {gmailUrl && (
        <a
          href={gmailUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink active:scale-90 pointer-coarse:size-9"
          title="Open in Gmail"
          aria-label="Open in Gmail"
        >
          <ExternalLink size={16} />
        </a>
      )}
    </div>
  );
}

function BulkSnooze({ ids, disabled, onDone }: { ids: string[]; disabled: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const snooze = useBulkSnooze();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  const pick = (until: Date) => {
    setOpen(false);
    snooze.mutate(
      { ids, until },
      {
        onSuccess: (r) => {
          showUndo({ message: `${r.snoozed} snoozed until ${formatDateTime(until.toISOString())}` });
          onDone();
        },
        onError: () => showUndo({ message: "Couldn't snooze. Try again." }),
      },
    );
  };

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" disabled={disabled || snooze.isPending} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Snooze">
        <AlarmClock size={15} /> <span className="max-sm:hidden">Snooze</span>
      </Button>
      {open && (
        <PopPanel onClose={() => setOpen(false)} title="Snooze until" className="absolute left-0 z-30 mt-1 w-56 rounded-xl border border-line bg-white p-1 shadow-lg">
          {snoozeOptions().map((o) => (
            <button key={o.label} onClick={() => pick(o.until)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 active:bg-slate-100">
              {o.label}
            </button>
          ))}
          <div className="mt-1 flex gap-1.5 border-t border-line p-1.5 pt-2">
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Snooze until" className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-sm" />
            <Button size="sm" variant="primary" disabled={!custom} onClick={() => pick(new Date(custom))}>
              Set
            </Button>
          </div>
        </PopPanel>
      )}
    </div>
  );
}
