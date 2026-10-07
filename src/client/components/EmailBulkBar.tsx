// One toolbar per email list instead of the same buttons on every email (user request 2026-10-06): tick
// emails, then Create task / Dismiss (pending ones) or Restore (the others). One selected email
// opens the usual task form; several become tasks straight away, titled with their subjects.
import type { ReactNode } from "react";
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
  idle,
  hideUntilSelected,
}: {
  threads: Thread[];
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  onCreateTask: (t: Thread) => void;
  className?: string;
  // Shown at the right instead of the (unusable) action buttons while nothing is ticked, e.g. the Emails
  // page's filters (cleanup, user request 2026-10-06). Without it the buttons stay, disabled.
  idle?: ReactNode;
  // The whole bar stays hidden until an email is ticked (Home's Pending Emails card, user request 2026-10-06):
  // tapping a sender picture selects the first email and the bar appears, with Select all.
  hideUntilSelected?: boolean;
}) {
  const bulkTask = useBulkTask();
  const bulkDismiss = useBulkDismiss();
  const bulkRestore = useBulkRestore();
  const busy = bulkTask.isPending || bulkDismiss.isPending || bulkRestore.isPending;
  // With filters in it (idle), the row stays when the list is empty so a filter can be turned off again.
  if (threads.length === 0 && !idle) return null;

  const picked = threads.filter((t) => selected.has(t.id));
  if (hideUntilSelected && picked.length === 0) return null;
  // Emails with another section (user request 2026-10-07) can still become tasks or be removed.
  const decidable = (t: Thread) => t.state === "needs_decision" || t.state === "elsewhere";
  const pending = picked.filter(decidable);
  const others = picked.filter((t) => t.state !== "needs_decision");
  // Show only the actions this list can use; they stay disabled until something fitting is ticked.
  const listHasPending = threads.some(decidable);
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
        showUndo({ message: `${plural(r.dismissed, "email")} removed` });
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
      {threads.length > 0 && (
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
      )}
      {idle && picked.length === 0 ? (
        <div className="ml-auto flex min-w-0 items-center gap-2">{idle}</div>
      ) : (
        <>
      {/* With filters (idle), only the actions that fit what's ticked show, so they stay on one row. */}
      {listHasPending && (!idle || pending.length > 0) && (
        <>
          <Button size="sm" variant="primary" disabled={!pending.length || busy} onClick={createTask}>
            <ListPlus size={15} /> <span className="max-sm:hidden">Create task</span>
            <span className="sm:hidden">Task</span>
          </Button>
          {/* "Remove" in warning red (user request 2026-10-06; was "Dismiss"). Gmail is not changed. */}
          <Button size="sm" variant="danger" disabled={!pending.length || busy} onClick={dismiss} title="Remove from Pending. Gmail is not changed.">
            <X size={15} /> Remove
          </Button>
        </>
      )}
      {listHasOthers && (!idle || others.length > 0) && (
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
        </>
      )}
    </div>
  );
}

