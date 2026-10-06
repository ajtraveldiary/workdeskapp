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
import { SelectAvatar } from "./Avatar";

// Email rows (user request 2026-10-06: tell sender, subject and email text apart at a glance): the sender is
// small and pastel red (user request 2026-10-06), the subject is the biggest and darkest line, the preview of the email text is small and light
// grey. Unread emails get a bolder sender and subject (plus the blue dot). Shared with Home's Pending emails.
export const emailLine = {
  sender: (unread: boolean) => cx("truncate text-footnote text-sender", unread ? "font-semibold" : "font-medium"),
  subject: (unread: boolean) =>
    cx("truncate text-subhead leading-snug transition-colors group-hover/title:text-brand-700", unread ? "font-semibold text-ink" : "font-medium text-slate-800"),
  preview: "min-w-0 truncate text-footnote text-slate-400",
};

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
        // The sender's picture is the tick box (user request 2026-10-06).
        <SelectAvatar name={thread.fromName ?? thread.fromEmail ?? "?"} selected={!!selected} onToggle={onSelect} label={`Select email from ${thread.fromName ?? thread.fromEmail ?? "unknown sender"}`} />
      )}
      <div className="min-w-0 flex-1">
        <OpenArea thread={thread} onOpen={onOpen}>
        <div className="flex items-baseline gap-2">
          {thread.unread && <span className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-brand-600" title="Unread in Gmail" />}
          <span className={emailLine.sender(thread.unread)}>
            {thread.fromName ?? thread.fromEmail ?? "Unknown sender"}
          </span>
          {thread.messageCount > 1 && <span className="text-xs text-slate-400">{thread.messageCount}</span>}
          <span className="ml-auto shrink-0 text-xs text-slate-500 tabular-nums">{formatWhen(thread.lastMessageAt)}</span>
        </div>
        <p className={emailLine.subject(thread.unread)}>{thread.subject}</p>
        {/* Compact (user request 2026-10-06): labels share the preview line. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <LabelChips ids={labelIds} max={2} className="shrink-0 flex-nowrap" />
          <p className={emailLine.preview}>{thread.snippet}</p>
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
