import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlarmClock, ExternalLink, ListPlus, Undo2, X } from "lucide-react";
import type { Category, Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { useDismiss, useRestore, useSetThreadCategory, useSnooze } from "../api";
import { formatDateTime, formatWhen } from "../format";
import { Button, cx } from "./ui";
import { EmailStatusTags } from "./EmailStatus";

export function ThreadRow({
  thread,
  categories,
  selected,
  onSelect,
  onCreateTask,
}: {
  thread: Thread;
  categories: Category[];
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onCreateTask: (t: Thread) => void;
}) {
  const dismiss = useDismiss();
  const restore = useRestore();
  const setCategory = useSetThreadCategory();
  const gmailUrl = gmailThreadUrl(thread.accountEmail, thread.gmailThreadId);
  const inQueue = thread.state === "needs_decision";

  return (
    <li className={cx("flex gap-3 px-4 py-3", selected && "bg-brand-50/60")}>
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label="Select email"
          className="mt-1 size-4 shrink-0 accent-brand-700"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {thread.unread && <span className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-brand-600" title="Unread in Gmail" />}
          <span className={cx("truncate text-sm", thread.unread ? "font-semibold text-slate-900" : "text-slate-700")}>
            {thread.fromName ?? thread.fromEmail ?? "Unknown sender"}
          </span>
          {thread.messageCount > 1 && <span className="text-xs text-slate-400">{thread.messageCount}</span>}
          <span className="ml-auto shrink-0 text-xs text-slate-500 tabular-nums">{formatWhen(thread.lastMessageAt)}</span>
        </div>
        <p className={cx("truncate", thread.unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>{thread.subject}</p>
        <p className="line-clamp-1 text-sm text-slate-500">{thread.snippet}</p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {inQueue && (
            <>
              <Button size="sm" variant="primary" onClick={() => onCreateTask(thread)}>
                <ListPlus size={15} /> Create task
              </Button>
              <SnoozeMenu id={thread.id} />
              <Button size="sm" onClick={() => dismiss.mutate(thread.id)} disabled={dismiss.isPending} title="Remove from the queue. Gmail is not changed.">
                <X size={15} /> Dismiss
              </Button>
            </>
          )}
          {!inQueue && <EmailStatusTags thread={thread} />}
          {thread.state === "snoozed" && thread.snoozedUntil && <span className="text-xs text-slate-500">until {formatDateTime(thread.snoozedUntil)}</span>}
          {!inQueue && (
            <Button size="sm" onClick={() => restore.mutate(thread.id)} disabled={restore.isPending}>
              <Undo2 size={15} /> Return to queue
            </Button>
          )}
          {gmailUrl ? (
            <a
              href={gmailUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <ExternalLink size={15} /> Open in Gmail
            </a>
          ) : (
            <span className="px-1 text-xs text-slate-400">Demo email</span>
          )}
          <select
            value={thread.categoryId ?? ""}
            onChange={(e) => setCategory.mutate({ id: thread.id, categoryId: e.target.value || null })}
            aria-label="Category"
            className="ml-auto h-8 max-w-40 rounded-md border border-transparent bg-transparent px-1.5 text-xs text-slate-500 hover:border-slate-200"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </li>
  );
}

function at(daysFromNow: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function snoozeOptions() {
  const now = new Date();
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    { label: "In 3 hours", until: new Date(now.getTime() + 3 * 3600_000) },
    { label: "Tomorrow, 9 AM", until: at(1, 9) },
    { label: "Monday, 9 AM", until: at(toMonday, 9) },
    { label: "In a week", until: at(7, 9) },
  ];
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
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Snooze" aria-label="Snooze" className={compact ? "w-8 px-0!" : undefined}>
        {icon ?? <AlarmClock size={15} />}
        {!compact && " Snooze"}
      </Button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-xl border border-line bg-white p-1 shadow-lg">
          {snoozeOptions().map((o) => (
            <button key={o.label} onClick={() => pick(o.until)} className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-100">
              {o.label}
            </button>
          ))}
          <div className="mt-1 border-t border-slate-100 p-2">
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-8 w-full rounded border border-slate-300 px-2 text-xs"
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
