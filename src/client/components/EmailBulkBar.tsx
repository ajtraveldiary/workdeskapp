// One toolbar per email list instead of the same buttons on every email (user request 2026-10-06): tick
// emails, then Create task / Dismiss (pending ones) or Restore (the others). One selected email
// opens the usual task form; several become tasks straight away, titled with their subjects.
import { ExternalLink, ListPlus, Undo2, X } from "lucide-react";
import type { Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useBulkDismiss, useBulkRestore, useBulkTask } from "../api";
import { showUndo } from "./SwipeRow";
import { Button, cx } from "./ui";

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

