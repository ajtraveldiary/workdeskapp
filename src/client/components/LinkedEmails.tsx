// More emails on a task or an event (user request 2026-10-17; user's choices: added from Task details / Event
// details out of Pending, behaving like the main email, listed with ✕ to take one off). The Emails section lists
// the main email first, then the added ones (tap opens one when the screen can open emails); "Add email" opens a
// list of Pending emails to tick one or more.
import { useState } from "react";
import { Check, Mail, Plus, Search, X } from "lucide-react";
import type { Thread } from "../../shared/types";
import { useLinkedEmailActions, useLinkedEmails, useThreads } from "../api";
import { formatWhen } from "../format";
import { Button, ErrorNote, Modal, Spinner, cx } from "./ui";

export type EmailOwner = { taskId: string } | { eventId: string };

export function LinkedEmailsSection({ owner, onOpenEmail }: { owner: EmailOwner; onOpenEmail?: (threadId: string) => void }) {
  const { data } = useLinkedEmails(owner);
  const { remove } = useLinkedEmailActions(owner);
  const [picking, setPicking] = useState(false);
  const emails = data?.emails ?? [];
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-slate-500">
          <Mail size={15} /> Emails{emails.length ? ` (${emails.length})` : ""}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
          <Plus size={15} /> Add email
        </Button>
      </div>
      {!data ? (
        <Spinner size={16} />
      ) : emails.length === 0 ? (
        <p className="text-footnote text-slate-500">No email yet. Add emails from Pending.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {emails.map((e) => {
            const body = (
              <>
                <span className="flex items-center gap-1.5 text-footnote text-slate-500">
                  {e.hasNewActivity && <span className="size-2 shrink-0 rounded-full bg-brand-600" title="New reply" aria-label="New reply" />}
                  <span className="truncate">{e.fromName ?? e.fromEmail}</span>
                  <span className="shrink-0">· {formatWhen(e.lastMessageAt)}</span>
                  {e.main && <span className="shrink-0 text-slate-400">· first</span>}
                </span>
                <span className="block text-sm text-ink [overflow-wrap:anywhere]">{e.subject}</span>
              </>
            );
            return (
              <li key={e.id} className="flex items-start gap-2 px-3 py-2">
                {onOpenEmail ? (
                  <button type="button" onClick={() => onOpenEmail(e.id)} className="group/title min-w-0 flex-1 text-left hover:[&>span:last-child]:text-brand-700" title="Open email">
                    {body}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1">{body}</span>
                )}
                {!e.main && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(e.id)}
                    disabled={remove.isPending}
                    aria-label={`Take off: ${e.subject}`}
                    title="Take off (back to Pending)"
                    className="shrink-0 rounded p-1 text-slate-400 enabled:hover:bg-slate-100 enabled:hover:text-urgent-ink active:scale-90"
                  >
                    <X size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ErrorNote error={remove.error} />
      <PendingPicker owner={owner} open={picking} exclude={emails.map((e) => e.id)} onClose={() => setPicking(false)} />
    </div>
  );
}

// The Pending emails to choose from: search, tick one or more, Add.
function PendingPicker({ owner, open, exclude, onClose }: { owner: EmailOwner; open: boolean; exclude: string[]; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add emails from Pending">
      {open && <PickerBody owner={owner} exclude={exclude} onDone={onClose} />}
    </Modal>
  );
}

function PickerBody({ owner, exclude, onDone }: { owner: EmailOwner; exclude: string[]; onDone: () => void }) {
  const { data, isLoading } = useThreads({ state: "needs_decision" });
  const { add } = useLinkedEmailActions(owner);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const query = q.trim().toLowerCase();
  const list = (data?.threads ?? []).filter(
    (t: Thread) => !exclude.includes(t.id) && (!query || [t.subject, t.fromName ?? "", t.fromEmail ?? "", t.snippet].some((s) => s.toLowerCase().includes(query))),
  );
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="space-y-3">
      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sender or subject" aria-label="Search Pending emails" className="h-9 w-full rounded-lg border border-line bg-white pr-2 pl-8 text-sm outline-none focus:border-brand-500" />
      </label>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner size={18} />
        </div>
      ) : list.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{query ? "No Pending email matches." : "Nothing in Pending."}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {list.map((t) => {
            const on = picked.has(t.id);
            return (
              <li key={t.id}>
                <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(t.id)} className={cx("flex w-full items-start gap-3 px-3 py-2 text-left active:bg-slate-100", on ? "bg-tint" : "hover:bg-slate-50")}>
                  <span className={cx("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex gap-2 text-footnote text-sender">
                      <span className="truncate">{t.fromName ?? t.fromEmail}</span>
                      <span className="ml-auto shrink-0 text-slate-500">{formatWhen(t.lastMessageAt)}</span>
                    </span>
                    <span className="block text-sm text-ink [overflow-wrap:anywhere]">{t.subject}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorNote error={add.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!picked.size || add.isPending} onClick={() => add.mutate([...picked], { onSuccess: onDone })}>
          <Plus size={16} /> {picked.size > 1 ? `Add ${picked.size} emails` : "Add email"}
        </Button>
      </div>
    </div>
  );
}
