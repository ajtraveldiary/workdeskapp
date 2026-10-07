// Remove, with "Send to a section" (user request 2026-10-07). Every Remove (toolbar, swipe, email viewer) opens
// this small pop-up (a sheet on phones): "Just remove" sends the emails to Removed as before (Gmail isn't
// changed), or pick a section and its label goes on the emails, in Gmail too, and they move to Other sections
// ("With <label>"), with Undo. Sections are the user's labels other than the task / done label and the ones
// ticked as only for organising mail (Settings > Mail). Opened from anywhere with openRemove(); it lives once
// in the app shell (RemoveChooserHost).
import { Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Thread } from "../../shared/types";
import { useLabels, useSendToSection, useTaskLabelSettings } from "../api";
import { showUndo } from "./SwipeRow";
import { Button, ErrorNote, Loading, Modal, Spinner, cx } from "./ui";

type RemoveRequest = {
  threads: Thread[];
  // The plain remove, as the caller did it before (it shows its own Undo).
  remove: () => void;
  // After either choice, e.g. clear the selection or close the email viewer.
  after?: () => void;
};

const MAX = 40; // emails sent to a section at once (one Gmail change each)

let opener: ((r: RemoveRequest) => void) | null = null;
export const openRemove = (r: RemoveRequest) => (opener ? opener(r) : r.remove());

export function RemoveChooserHost() {
  const [req, setReq] = useState<RemoveRequest | null>(null);
  useEffect(() => {
    opener = setReq;
    return () => {
      opener = null;
    };
  }, []);
  const many = (req?.threads.length ?? 0) > 1;
  return (
    <Modal open={req !== null} onClose={() => setReq(null)} title={many ? `Remove ${req!.threads.length} emails` : "Remove email"} closeOnBackdrop>
      {req && <Chooser key={req.threads.map((t) => t.id).join()} req={req} onDone={() => setReq(null)} />}
    </Modal>
  );
}

function Chooser({ req, onDone }: { req: RemoveRequest; onDone: () => void }) {
  const labels = useLabels();
  const settings = useTaskLabelSettings();
  const send = useSendToSection();
  const { threads } = req;
  const single = threads.length === 1 ? threads[0]! : null;
  const notSections = new Set([settings.data?.taskLabelId, settings.data?.doneLabelId, ...(settings.data?.organizeLabelIds ?? [])].filter(Boolean));
  const sections = (labels.data?.labels ?? []).filter((l) => l.id.startsWith("Label_") && !notSections.has(l.id));
  const tooMany = threads.length > MAX;

  const justRemove = () => {
    onDone();
    req.remove();
    req.after?.();
  };
  const sendTo = (labelId: string, name: string) => {
    const ids = threads.map((t) => t.id);
    // Undo puts each email back exactly as it was (Pending, "Back from" a section, or another section).
    const previous = threads.map((t) => ({ id: t.id, state: t.state === "elsewhere" ? ("elsewhere" as const) : ("needs_decision" as const), sectionLabelId: t.sectionLabelId ?? null }));
    send.mutate(
      { ids, labelId },
      {
        onSuccess: (r) => {
          onDone();
          req.after?.();
          showUndo({
            message: `${r.moved === 1 ? "Email" : `${r.moved} emails`} sent to ${name}`,
            onUndo: () => send.mutate({ ids, labelId, undo: true, previous }),
          });
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      {single && <p className="line-clamp-2 text-sm font-medium text-ink [overflow-wrap:anywhere]">{single.subject || "(no subject)"}</p>}

      <div>
        <Button variant="danger" onClick={justRemove} disabled={send.isPending} className="w-full">
          <X size={15} /> Just remove
        </Button>
        <p className="mt-1 text-footnote text-slate-500">Goes to Removed. Gmail isn't changed.</p>
      </div>

      <div>
        <p className="text-sm font-medium text-ink">Or send to a section</p>
        <p className="mt-0.5 text-footnote text-slate-500">Adds the section's label in Gmail too; the email moves to Other sections. A new reply brings it back to Pending.</p>
        {labels.isLoading || settings.isLoading ? (
          <Loading className="py-6" />
        ) : sections.length === 0 ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5 text-footnote text-slate-600">
            No sections yet. Every Gmail label except your task and completed labels, and the ones marked only for organising mail, is a section.{" "}
            <Link to="/settings" onClick={onDone} className="font-medium text-brand-700 hover:underline">
              Settings &gt; Mail
            </Link>
          </p>
        ) : tooMany ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5 text-footnote text-slate-600">Choose up to {MAX} emails at a time to send them to a section.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {sections.map((l) => {
              const current = threads.every((t) => t.state === "elsewhere" && t.sectionLabelId === l.id);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => sendTo(l.id, l.name)}
                    disabled={send.isPending || current}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-ink enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:opacity-50"
                  >
                    <span
                      aria-hidden
                      className={cx("flex size-6 shrink-0 items-center justify-center rounded-md", !l.backgroundColor && "bg-slate-200 text-slate-600")}
                      style={l.backgroundColor ? { backgroundColor: l.backgroundColor, color: l.textColor ?? "#000" } : undefined}
                    >
                      <Tag size={13} />
                    </span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.name}</span>
                    {current && <span className="shrink-0 text-footnote text-slate-500">Already here</span>}
                    {send.isPending && send.variables?.labelId === l.id && <Spinner size={16} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ErrorNote error={send.error} />
    </div>
  );
}
