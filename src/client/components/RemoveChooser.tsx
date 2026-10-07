// Remove, with "Send to a section" (user request 2026-10-07). Every Remove (toolbar, swipe, email viewer) opens
// a small menu that grows out of the Remove button (user request 2026-10-07: "a mini pop-up expanding from the
// remove button", replacing a full pop-up); on phones it is a compact action sheet, like every phone drop-down.
// "Just remove" sends the emails to Removed as before (Gmail isn't changed), or pick a section and its label
// goes on the emails, in Gmail too, and they move to Other sections ("With <label>"), with Undo. Sections are
// the user's labels other than the task / done label and the ones ticked as only for organising mail
// (Settings > Mail). Opened from anywhere with openRemove(); it lives once in the app shell (RemoveChooserHost).
import { Tag, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import type { Thread } from "../../shared/types";
import { useLabels, useSendToSection, useTaskLabelSettings } from "../api";
import { usePhone } from "./sheet";
import { showUndo } from "./SwipeRow";
import { ActionSheet, ErrorNote, Spinner, cx } from "./ui";

type RemoveRequest = {
  threads: Thread[];
  // The plain remove, as the caller did it before (it shows its own Undo).
  remove: () => void;
  // After either choice, e.g. clear the selection or close the email viewer.
  after?: () => void;
  // The Remove button that was tapped: the menu grows out of it (wider screens).
  anchor?: HTMLElement | null;
};

const MAX = 40; // emails sent to a section at once (one Gmail change each)
const WIDTH = 272;

let opener: ((r: RemoveRequest) => void) | null = null;
export const openRemove = (r: RemoveRequest) => (opener ? opener(r) : r.remove());

export function RemoveChooserHost() {
  const [req, setReq] = useState<RemoveRequest | null>(null);
  const phone = usePhone();
  useEffect(() => {
    opener = setReq;
    return () => {
      opener = null;
    };
  }, []);
  if (!req) return null;
  const close = () => setReq(null);
  const key = req.threads.map((t) => t.id).join();
  const single = req.threads.length === 1 ? req.threads[0]! : null;
  // Phones, and a swipe action (its button is gone once tapped): a compact action sheet.
  if (phone || !req.anchor?.isConnected)
    return (
      <ActionSheet onClose={close} title={single ? single.subject || "(no subject)" : `${req.threads.length} emails`}>
        <div className="overflow-hidden rounded-xl bg-white">
          <Choices key={key} req={req} onDone={close} />
        </div>
      </ActionSheet>
    );
  return (
    <AnchoredMenu key={key} anchor={req.anchor} onClose={close}>
      <Choices req={req} onDone={close} />
    </AnchoredMenu>
  );
}

// A small menu under (or above) the Remove button, growing out of it. It is a popover in the top layer and,
// for a button inside a pop-up (the email viewer), lives inside that pop-up so it isn't covered or blocked.
function AnchoredMenu({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showPopover?.();
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = el.offsetHeight;
      // Line up with the button's left edge, or its right edge when that keeps it on screen better.
      const fitsRight = r.left + WIDTH <= window.innerWidth - 8;
      const left = fitsRight ? r.left : Math.max(8, r.right - WIDTH);
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
      setPos({ left, top, origin: `${below ? "top" : "bottom"} ${fitsRight ? "left" : "right"}` });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  useEffect(() => {
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // closes the menu only, not the email viewer under it
      onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", esc, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={ref}
      popover="manual"
      role="dialog"
      aria-label="Remove"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: WIDTH, transformOrigin: pos?.origin }}
      className={cx("fixed inset-auto m-0 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-white p-1 text-ink shadow-xl", pos && "grow-in")}
    >
      {children}
    </div>,
    anchor.closest("dialog") ?? document.body,
  );
}

function Choices({ req, onDone }: { req: RemoveRequest; onDone: () => void }) {
  const labels = useLabels();
  const settings = useTaskLabelSettings();
  const send = useSendToSection();
  const { threads } = req;
  const notSections = new Set([settings.data?.taskLabelId, settings.data?.doneLabelId, ...(settings.data?.organizeLabelIds ?? [])].filter(Boolean));
  const sections = (labels.data?.labels ?? []).filter((l) => l.id.startsWith("Label_") && !notSections.has(l.id));
  const tooMany = threads.length > MAX;
  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:opacity-50 pointer-coarse:py-2.5";

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
    <div>
      <button type="button" onClick={justRemove} disabled={send.isPending} className={cx(item, "font-medium text-urgent-ink")} title="Goes to Removed. Gmail isn't changed.">
        <X size={16} className="shrink-0" /> Just remove
      </button>
      <div className="my-1 border-t border-line" />
      <p className="px-2.5 pt-1 pb-0.5 text-caption font-medium text-slate-500">Send to a section · adds the label in Gmail</p>
      {labels.isLoading || settings.isLoading ? (
        <div className="flex justify-center py-3">
          <Spinner size={18} />
        </div>
      ) : sections.length === 0 ? (
        <p className="px-2.5 py-1.5 text-footnote text-slate-500">
          No sections yet.{" "}
          <Link to="/settings" onClick={onDone} className="font-medium text-brand-700 hover:underline">
            Settings &gt; Mail
          </Link>
        </p>
      ) : tooMany ? (
        <p className="px-2.5 py-1.5 text-footnote text-slate-500">Choose up to {MAX} emails to send them to a section.</p>
      ) : (
        sections.map((l) => {
          const current = threads.every((t) => t.state === "elsewhere" && t.sectionLabelId === l.id);
          return (
            <button key={l.id} type="button" onClick={() => sendTo(l.id, l.name)} disabled={send.isPending || current} className={item}>
              <span
                aria-hidden
                className={cx("flex size-5 shrink-0 items-center justify-center rounded", !l.backgroundColor && "bg-slate-200 text-slate-600")}
                style={l.backgroundColor ? { backgroundColor: l.backgroundColor, color: l.textColor ?? "#000" } : undefined}
              >
                <Tag size={11} />
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.name}</span>
              {current && <span className="shrink-0 text-caption text-slate-500">Already here</span>}
              {send.isPending && send.variables?.labelId === l.id && <Spinner size={14} />}
            </button>
          );
        })
      )}
      {send.error ? (
        <div className="px-1 pt-1">
          <ErrorNote error={send.error} />
        </div>
      ) : null}
    </div>
  );
}
