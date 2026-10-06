import type { ReactNode } from "react";
import { ExternalLink, ListPlus, Undo2, X } from "lucide-react";
import { SwipeRow, showUndo, useSwipeMode } from "./SwipeRow";
import type { Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useDismiss, useRestore } from "../api";
import { formatWhen } from "../format";
import { cx } from "./ui";
import { EmailStatusTags } from "./EmailStatus";
import { LabelChips } from "./LabelChips";

export function ThreadRow({
  thread,
  selected,
  onSelect,
  onCreateTask,
  onOpen,
}: {
  thread: Thread;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onCreateTask: (t: Thread) => void;
  // When given, tapping the email's text opens it in the viewer.
  onOpen?: (t: Thread) => void;
}) {
  const dismiss = useDismiss();
  const restore = useRestore();
  const labelIds = thread.labelIds ?? [];
  const gmailUrl = gmailThreadUrl(thread.accountEmail, thread.gmailThreadId);
  const inQueue = thread.state === "needs_decision";
  // Phones: swipe right to make a task (or restore), left for Gmail / dismiss; the button bar goes away.
  // (Snooze was removed from the app, user request 2026-10-06.)
  const swipe = useSwipeMode();

  return (
    <SwipeRow
      contentClassName={cx("flex py-2 transition-colors sm:py-2.5", swipe ? "gap-2.5 px-3" : "gap-3 px-4", selected ? "bg-brand-50/60" : "has-[:is(button,a):hover]:bg-slate-50/80")}
      leading={
        inQueue
          ? { label: "Task", icon: ListPlus, tone: "brand", onClick: () => onCreateTask(thread) }
          : { label: "Restore", icon: Undo2, tone: "brand", onClick: () => restore.mutateAsync(thread.id) }
      }
      trailing={[
        { label: "Gmail", icon: ExternalLink, tone: "info", href: gmailUrl ?? undefined, hidden: !gmailUrl },
        {
          label: "Dismiss",
          icon: X,
          tone: "neutral",
          hidden: !inQueue,
          onClick: () => dismiss.mutateAsync(thread.id).then(() => showUndo({ message: "Email dismissed", undo: { kind: "restore", id: thread.id } })),
        },
      ]}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label="Select email"
          className="mt-0.5 size-4 shrink-0 accent-brand-700 pointer-coarse:size-5"
        />
      )}
      <div className="min-w-0 flex-1">
        <OpenArea thread={thread} onOpen={onOpen}>
        <div className="flex items-baseline gap-2">
          {thread.unread && <span className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-brand-600" title="Unread in Gmail" />}
          <span className={cx("truncate text-sm", thread.unread ? "font-semibold text-slate-900" : "text-slate-700")}>
            {thread.fromName ?? thread.fromEmail ?? "Unknown sender"}
          </span>
          {thread.messageCount > 1 && <span className="text-xs text-slate-400">{thread.messageCount}</span>}
          <span className="ml-auto shrink-0 text-xs text-slate-500 tabular-nums">{formatWhen(thread.lastMessageAt)}</span>
        </div>
        <p className={cx("truncate text-[0.9375rem] transition-colors group-hover/title:text-brand-700", thread.unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>{thread.subject}</p>
        {/* Compact (user request 2026-10-06): labels share the preview line. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <LabelChips ids={labelIds} max={2} className="shrink-0 flex-nowrap" />
          <p className="min-w-0 truncate text-sm text-slate-500">{thread.snippet}</p>
        </div>
        </OpenArea>

        {/* The actions live in the list's toolbar (EmailBulkBar), not on every email (user request 2026-10-06);
            phones also swipe. Only the state of emails outside Pending is shown here. */}
        {!inQueue && (
          <div className="mt-1 flex flex-wrap items-center gap-2 empty:hidden">
            <EmailStatusTags thread={thread} />
          </div>
        )}
      </div>
    </SwipeRow>
  );
}

function OpenArea({ thread, onOpen, children }: { thread: Thread; onOpen?: (t: Thread) => void; children: ReactNode }) {
  if (!onOpen) return <>{children}</>;
  return (
    <button onClick={() => onOpen(thread)} className="group/title block w-full text-left" aria-label={`Open email: ${thread.subject}`}>
      {children}
    </button>
  );
}
