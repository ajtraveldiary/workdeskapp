import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlarmClock, ExternalLink, ListPlus, Undo2, X } from "lucide-react";
import { SwipeRow, showUndo, useSwipeMode } from "./SwipeRow";
import type { Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useDismiss, useRestore, useSnooze } from "../api";
import { formatDateTime, formatWhen } from "../format";
import { Button, Modal, cx } from "./ui";
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
  // Phones: swipe right to make a task (or restore), left for Gmail / snooze / dismiss; the button bar goes away.
  const swipe = useSwipeMode();
  const [snoozing, setSnoozing] = useState(false);

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
        { label: "Snooze", icon: AlarmClock, tone: "snooze", onClick: () => setSnoozing(true), hidden: !inQueue },
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
            {thread.state === "snoozed" && thread.snoozedUntil && <span className="text-xs text-slate-500">until {formatDateTime(thread.snoozedUntil)}</span>}
          </div>
        )}
      </div>
      <SnoozeSheet id={snoozing ? thread.id : null} onClose={() => setSnoozing(false)} />
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

function at(daysFromNow: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function snoozeOptions() {
  const now = new Date();
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    { label: "In 3 hours", until: new Date(now.getTime() + 3 * 3600_000) },
    { label: "Tomorrow, 9 AM", until: at(1, 9) },
    { label: "Monday, 9 AM", until: at(toMonday, 9) },
    { label: "In a week", until: at(7, 9) },
  ];
}

export function SnoozeSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const snooze = useSnooze();
  const pick = (until: Date) => {
    if (!id) return;
    // The promise (not mutate's onSuccess) so the undo still shows after the row has left the list.
    snooze
      .mutateAsync({ id, until })
      .then(() => showUndo({ message: `Snoozed until ${formatDateTime(until.toISOString())}`, undo: { kind: "restore", id } }))
      .catch(() => showUndo({ message: "Couldn't snooze. Try again." }));
    onClose();
  };
  return (
    <Modal open={!!id} onClose={onClose} title="Snooze until">
      <div className="-mx-2 -mt-2">
        {snoozeOptions().map((o) => (
          <button key={o.label} onClick={() => pick(o.until)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50 active:bg-slate-100">
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t border-line pt-3">
        <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Snooze until" className="h-9 min-w-0 flex-1 rounded-lg border border-line px-2 text-sm" />
        <Button size="sm" variant="primary" disabled={!custom} onClick={() => pick(new Date(custom))}>
          Snooze
        </Button>
      </div>
    </Modal>
  );
}

export function SnoozeMenu({ id, icon, compact }: { id: string; icon?: ReactNode; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const snooze = useSnooze();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (until: Date) => {
    snooze.mutate({ id, until });
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Snooze" aria-label="Snooze" className={compact ? "w-8 px-0! pointer-coarse:w-9" : undefined}>
        {icon ?? <AlarmClock size={15} />}
        {!compact && " Snooze"}
      </Button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-xl border border-line bg-white p-1 shadow-lg">
          {snoozeOptions().map((o) => (
            <button key={o.label} onClick={() => pick(o.until)} className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-100 pointer-coarse:py-2.5">
              {o.label}
            </button>
          ))}
          <div className="mt-1 border-t border-slate-100 p-2">
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-8 w-full rounded border border-slate-300 px-2 text-xs pointer-coarse:h-9"
            />
            <Button size="sm" className="mt-1.5 w-full" disabled={!custom} onClick={() => pick(new Date(custom))}>
              Snooze until then
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
