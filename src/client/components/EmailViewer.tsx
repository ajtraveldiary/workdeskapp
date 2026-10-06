// Full-screen email viewer: the conversation on one side, the selected attachment (PDF or image) on the other.
// On phones and tablets the email comes first and the attachment preview follows it further down the same
// scroll (user request 2026-10-06). Content comes from Gmail on demand and is never stored in WorkDesk's database.
import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, Download, ExternalLink, File, FileText, Image as ImageIcon, ListPlus, Maximize2, Paperclip, Share, X } from "lucide-react";
import type { EmailAttachment, EmailMessageContent, Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { attachmentUrl, useDismiss, useEmailContent, useMarkRead, useSnippets } from "../api";
import { htmlToText, stripSnippetsFromHtml } from "../snippets";
import { stripSnippets } from "../../shared/snippets";
import { formatDateTime } from "../format";
import { Avatar } from "./Avatar";
import { EmailStatusTags } from "./EmailStatus";
import { LabelChips, LabelPicker } from "./LabelChips";
import { SnoozeMenu } from "./ThreadRow";
import { Button, Loading, Spinner, cx } from "./ui";
import { showUndo } from "./SwipeRow";

const PdfPreview = lazy(() => import("./PdfPreview"));

const VIEWABLE_IMAGE = /^image\/(png|jpe?g|gif|webp)$/;
const isPdf = (a: EmailAttachment) => a.mimeType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf");
const isImage = (a: EmailAttachment) => VIEWABLE_IMAGE.test(a.mimeType);

type Selected = { message: EmailMessageContent; attachment: EmailAttachment };

// Wide enough for the side-by-side layout (Tailwind's lg).
const WIDE = "(min-width: 1024px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailViewer({ thread, onClose, onCreateTask }: { thread: Thread | null; onClose: () => void; onCreateTask: (t: Thread) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (thread && !d.open) {
      // Undo where a pull-to-close left the sheet.
      d.style.transition = "";
      d.style.transform = "";
      d.showModal();
      // Focus the sheet itself, not its first button, so no focus ring shows on open; Tab still reaches the buttons.
      d.focus();
    }
    if (!thread && d.open) d.close();
  }, [thread]);
  usePullToClose(ref, onClose, !!thread);

  return (
    <dialog
      ref={ref}
      // Only its own close: React passes the attachment viewer's close event up through the portal too.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      aria-label={thread?.subject ?? "Email"}
      tabIndex={-1}
      className="sheet m-0 outline-none h-dvh max-h-none w-full max-w-none bg-white p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:m-auto sm:p-0 sm:h-[min(100dvh-2rem,60rem)] sm:w-[min(100vw-2rem,84rem)] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
    >
      {thread && <ViewerBody key={thread.id} thread={thread} onClose={onClose} onCreateTask={onCreateTask} />}
    </dialog>
  );
}

// Phones: pull the viewer down to close it, like an app sheet (user request 2026-10-06). The pull starts on the
// top bar and header, or on the email while it is scrolled to the top (not inside an email's own HTML frame).
const PHONE = "(max-width: 639.98px)";
function usePullToClose(ref: RefObject<HTMLDialogElement | null>, onClose: () => void, open: boolean) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el || !open || !window.matchMedia(PHONE).matches) return;
    let state: "idle" | "maybe" | "drag" = "idle";
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dy = 0;
    const place = (y: number, animate: boolean) => {
      el.style.transition = animate ? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
      el.style.transform = y ? `translateY(${y}px)` : "";
    };
    const start = (e: TouchEvent) => {
      const scroller = (e.target as Element).closest?.("[data-sheet-scroll]");
      if (e.touches.length !== 1 || (scroller && scroller.scrollTop > 0)) return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      startT = e.timeStamp;
      dy = 0;
      state = "maybe";
    };
    const move = (e: TouchEvent) => {
      if (state === "idle") return;
      const x = e.touches[0]!.clientX - startX;
      const y = e.touches[0]!.clientY - startY;
      if (state === "maybe") {
        // Sideways swipes and upward scrolls are left alone.
        if ((Math.abs(x) > 8 && Math.abs(x) > Math.abs(y)) || y < -4) return void (state = "idle");
        if (y < 8) return;
        state = "drag";
      }
      e.preventDefault();
      dy = Math.max(0, y);
      place(dy, false);
    };
    const end = (e: TouchEvent) => {
      if (state !== "drag") return void (state = "idle");
      state = "idle";
      const speed = dy / Math.max(1, e.timeStamp - startT);
      if (dy > 140 || (dy > 50 && speed > 0.6)) {
        place(el.offsetHeight, true);
        setTimeout(() => closeRef.current(), 200);
      } else place(0, true);
    };
    const cancel = () => {
      if (state === "drag") place(0, true);
      state = "idle";
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", cancel);
    };
  }, [ref, open]);
}

function ViewerBody({ thread, onClose, onCreateTask }: { thread: Thread; onClose: () => void; onCreateTask: (t: Thread) => void }) {
  const { data, error, isPending, refetch } = useEmailContent(thread);
  const dismiss = useDismiss();
  const markRead = useMarkRead();
  const gmailUrl = gmailThreadUrl(thread.accountEmail, thread.gmailThreadId);
  const inQueue = thread.state === "needs_decision";

  // Once an unread email has loaded, mark it read here and in Gmail (one request per opening).
  const markedRef = useRef(false);
  useEffect(() => {
    if (data && thread.unread && !markedRef.current) {
      markedRef.current = true;
      markRead.mutate(thread.id);
    }
  }, [data, thread.unread, thread.id, markRead]);
  const needsSignIn = markRead.data?.marked === false && markRead.data.reason === "permission";
  // Labels shown here follow the picker straight away; the lists refresh from the server.
  const [labelIds, setLabelIds] = useState(thread.labelIds);

  // Newest message first; the preview starts on the newest PDF (or image) in the conversation.
  const messages = useMemo(() => [...(data?.messages ?? [])].reverse(), [data]);
  const files = useMemo(() => messages.flatMap((m) => m.attachments.filter((a) => !a.inline).map((a) => ({ message: m, attachment: a }))), [messages]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const share = useEmailShare(thread, messages, files);
  useEffect(() => {
    if (!selected && files.length) setSelected(files.find((f) => isPdf(f.attachment)) ?? files.find((f) => isImage(f.attachment)) ?? files[0]!);
  }, [files, selected]);

  // Narrow screens: tapping an attachment shows it in the preview below the email and scrolls there.
  const wide = useWide();
  const inlineRef = useRef<HTMLElement>(null);
  const open = (f: Selected) => {
    setSelected(f);
    if (!wide) requestAnimationFrame(() => inlineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="flex h-full flex-col">
      {/* Phones: app-style top bar (user request 2026-10-06): close on the left, a grab handle for pulling the
          sheet down, and the label and Gmail buttons on the right. Wider screens keep them in the header below. */}
      <div className="relative flex items-center px-1.5 pt-2 sm:hidden">
        <span aria-hidden="true" className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-slate-300" />
        <button onClick={onClose} className="inline-flex size-10 items-center justify-center rounded-full text-slate-600 active:scale-90 active:bg-slate-100" aria-label="Close">
          <ChevronDown size={26} strokeWidth={2} />
        </button>
        <div className="ml-auto flex items-center gap-1 pr-1">
          <ShareButton share={share} className="size-10 rounded-full" />
          <LabelPicker thread={thread} selected={labelIds} onChange={setLabelIds} />
          {gmailUrl && (
            <a href={gmailUrl} target="_blank" rel="noreferrer" className="inline-flex size-10 items-center justify-center rounded-full text-slate-500 active:scale-90 active:bg-slate-100" aria-label="Open in Gmail">
              <ExternalLink size={20} />
            </a>
          )}
        </div>
      </div>

      {/* Header: subject, sender and the usual email actions */}
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-4 pt-1 pb-3 sm:px-5 sm:py-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="line-clamp-2 text-lg leading-snug font-semibold text-ink">{thread.subject}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-slate-500">
            <span className="font-medium text-slate-700">{thread.fromName ?? thread.fromEmail}</span>
            <span>· {formatDateTime(thread.lastMessageAt)}</span>
            {thread.messageCount > 1 && <span>· {thread.messageCount} messages</span>}
            {!inQueue && <EmailStatusTags thread={thread} />}
            <LabelChips ids={labelIds} max={6} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inQueue && (
            <>
              <Button size="sm" variant="primary" onClick={() => onCreateTask(thread)}>
                <ListPlus size={15} /> Create task
              </Button>
              <SnoozeMenu id={thread.id} />
              <Button size="sm" onClick={() => dismiss.mutate(thread.id, { onSuccess: onClose })} disabled={dismiss.isPending} title="Remove from the queue. Gmail is not changed.">
                <X size={15} /> Dismiss
              </Button>
            </>
          )}
          {/* On phones these live in the top bar above. */}
          <div className="contents max-sm:hidden">
            <ShareButton share={share} className="size-9 rounded-lg hover:bg-slate-100" />
            <LabelPicker thread={thread} selected={labelIds} onChange={setLabelIds} />
            {gmailUrl && (
              <a href={gmailUrl} target="_blank" rel="noreferrer" className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink pointer-coarse:size-9" title="Open in Gmail" aria-label="Open in Gmail">
                <ExternalLink size={18} />
              </a>
            )}
            <button onClick={onClose} className="inline-flex size-9 items-center justify-center rounded-full border border-line text-slate-600 hover:bg-slate-100 hover:text-ink pointer-coarse:size-9" aria-label="Close" title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
      </header>

      {needsSignIn && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-snooze-soft px-4 py-2 text-[0.8125rem] text-snooze-ink sm:px-5">
          To also mark emails read in Gmail, WorkDesk needs one more permission.
          <a href="/api/auth/google" className="font-medium underline">
            Sign in again to allow it
          </a>
        </div>
      )}

      <div className="relative grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: the conversation and its attachments */}
        <section data-sheet-scroll className="scroll-thin min-h-0 overflow-y-auto px-4 py-4 sm:px-5" aria-label="Email">
          {isPending ? (
            <Loading label="Loading email…" className="py-16" />
          ) : error ? (
            <div className="py-16 text-center text-sm">
              <p className="text-urgent-ink">Couldn't load this email: {error.message}</p>
              <div className="mt-3 flex justify-center gap-2">
                <Button size="sm" onClick={() => refetch()}>Try again</Button>
                {gmailUrl && (
                  <a href={gmailUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-[0.8125rem] font-medium pointer-coarse:h-9">
                    Open in Gmail
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <MessageBlock key={m.id} threadId={thread.id} message={m} initiallyOpen={i === 0} selected={selected} onOpenFile={open} />
              ))}
            </div>
          )}

          {/* Phones and tablets: the attachment follows the email; scroll down to it */}
          {!wide && selected && !error && (
            <section ref={inlineRef} className="mt-4 scroll-mt-2 overflow-hidden rounded-xl border border-line bg-canvas-soft" aria-label="Attachment preview">
              {files.length > 1 && (
                <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-line bg-white px-3 py-2">
                  {files.map((f) => {
                    const active = f.message.id === selected.message.id && f.attachment.partId === selected.attachment.partId;
                    return (
                      <button
                        key={`${f.message.id}:${f.attachment.partId}`}
                        onClick={() => setSelected(f)}
                        aria-pressed={active}
                        className={cx(
                          "max-w-48 shrink-0 truncate rounded-full border px-3 py-1 text-xs font-medium active:scale-[0.97]",
                          active ? "border-brand-500 bg-tint text-brand-700" : "border-line text-slate-600",
                        )}
                      >
                        {f.attachment.filename}
                      </button>
                    );
                  })}
                </div>
              )}
              <Preview threadId={thread.id} selected={selected} empty={false} inline />
            </section>
          )}
        </section>

        {/* Right (wide screens): the selected attachment */}
        {wide && (
          <aside className="flex min-h-0 flex-col border-l border-line bg-canvas-soft" aria-label="Attachment preview">
            <Preview threadId={thread.id} selected={selected} empty={!isPending && files.length === 0} />
          </aside>
        )}
      </div>
    </div>
  );
}

function MessageBlock({
  threadId,
  message,
  initiallyOpen,
  selected,
  onOpenFile,
}: {
  threadId: string;
  message: EmailMessageContent;
  initiallyOpen: boolean;
  selected: Selected | null;
  onOpenFile: (f: Selected) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const name = message.fromName ?? message.fromEmail ?? "Unknown sender";
  // Settings > Mail > Hidden text: saved snippets (signatures, disclaimers) are left out, with a way to show them.
  const hidden = useSnippets().data;
  const [showHidden, setShowHidden] = useState(false);
  const clean = useMemo(() => {
    const list = (hidden ?? []).map((x) => x.text);
    if (message.html) {
      const r = stripSnippetsFromHtml(message.html, list);
      return { html: r.html, text: null, removed: r.removed };
    }
    const r = stripSnippets(message.text ?? "", list);
    return { html: null, text: r.text, removed: r.removed };
  }, [message, hidden]);
  const showOriginal = showHidden || clean.removed === 0;
  const files = message.attachments.filter((a) => !a.inline);
  const cids = useMemo(
    () => Object.fromEntries(message.attachments.filter((a) => a.contentId).map((a) => [a.contentId!, attachmentUrl(threadId, message.id, a.partId)])),
    [message, threadId],
  );

  return (
    <article className="rounded-xl border border-line bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <Avatar name={name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-ink">{name}</span>
            <span className="ml-auto shrink-0 text-xs text-slate-500">{formatDateTime(message.date)}</span>
          </div>
          <p className="truncate text-xs text-slate-500">
            {message.fromEmail}
            {message.to && ` → ${message.to}`}
          </p>
          {!open && <p className="mt-1 line-clamp-1 text-[0.8125rem] text-slate-500">{(message.text ?? "").slice(0, 160) || "(Tap to show)"}</p>}
        </div>
        {files.length > 0 && <Paperclip size={15} className="mt-1 shrink-0 text-slate-400" aria-label={`${files.length} attachments`} />}
      </button>

      {open && (
        <div className="border-t border-line px-4 py-4">
          {message.html ? (
            <HtmlBody html={showOriginal ? message.html : clean.html!} cids={cids} />
          ) : (
            <div className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">{(showOriginal ? message.text : clean.text) || "(No text in this message)"}</div>
          )}
          {clean.removed > 0 && (
            <button onClick={() => setShowHidden((v) => !v)} className="mt-2 text-xs font-medium text-slate-500 hover:text-brand-700 hover:underline">
              {showHidden ? "Hide saved text again" : `Show hidden text (${clean.removed})`}
            </button>
          )}

          {files.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-slate-600">
                <Paperclip size={14} /> Attachments ({files.length})
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((a) => {
                  const active = selected?.message.id === message.id && selected.attachment.partId === a.partId;
                  const Icon = isPdf(a) ? FileText : isImage(a) ? ImageIcon : File;
                  return (
                    <button
                      key={a.partId}
                      onClick={() => onOpenFile({ message, attachment: a })}
                      className={cx(
                        "flex min-h-24 flex-col items-start gap-2 rounded-lg border p-3 text-left transition hover:shadow-sm active:scale-[0.98]",
                        active ? "border-brand-500 bg-tint ring-1 ring-brand-500" : "border-line bg-white hover:border-slate-300",
                      )}
                    >
                      <span className={cx("flex size-9 items-center justify-center rounded-md text-white", isPdf(a) ? "bg-urgent" : isImage(a) ? "bg-info" : "bg-slate-400")}>
                        <Icon size={18} />
                      </span>
                      <span className="line-clamp-2 text-[0.8125rem] leading-snug font-medium break-all text-ink">{a.filename}</span>
                      <span className="text-xs text-slate-500">{formatSize(a.size)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// HTML email in a sandboxed frame: no scripts or forms, links open in a new tab, and pictures from the
// internet stay blocked until asked for (they can tell the sender you opened the email).
function HtmlBody({ html, cids }: { html: string; cids: Record<string, string> }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [remote, setRemote] = useState(false);
  const hasRemote = /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:/i.test(html);
  const srcDoc = useMemo(() => {
    const body = html.replace(/cid:([^"'\s)>]+)/gi, (m, id: string) => cids[id] ?? m);
    const ext = remote ? " https: http:" : "";
    const csp = `default-src 'none'; img-src 'self' data:${ext}; style-src 'unsafe-inline'${ext}; font-src data:${ext}`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0;background:#fff}body{font:14px/1.6 "Segoe UI",system-ui,-apple-system,sans-serif;color:#1c1d26;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${body}</body></html>`;
  }, [html, cids, remote]);

  // Grow the frame to fit the email, so the panel scrolls rather than the frame.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const fit = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      frame.style.height = `${doc.documentElement.scrollHeight}px`;
      observer?.disconnect();
      observer = new ResizeObserver(() => (frame.style.height = `${doc.documentElement.scrollHeight}px`));
      observer.observe(doc.body);
    };
    frame.addEventListener("load", fit);
    if (frame.contentDocument?.readyState === "complete") fit();
    return () => {
      frame.removeEventListener("load", fit);
      observer?.disconnect();
    };
  }, [srcDoc]);

  return (
    <div>
      {hasRemote && !remote && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-snooze-soft px-3 py-2 text-[0.8125rem] text-snooze-ink">
          Pictures from the internet are hidden to protect your privacy.
          <button onClick={() => setRemote(true)} className="font-medium underline">
            Show pictures
          </button>
        </div>
      )}
      <iframe ref={ref} title="Email content" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={srcDoc} className="block min-h-24 w-full border-0" />
    </div>
  );
}

// inline: part of the email's scroll (narrow screens) instead of a panel that scrolls on its own.
function Preview({ threadId, selected, empty, inline }: { threadId: string; selected: Selected | null; empty: boolean; inline?: boolean }) {
  const [viewing, setViewing] = useState(false);
  if (!selected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-slate-500">
        <Paperclip size={28} className="mb-2 text-slate-300" />
        {empty ? "No attachments in this conversation." : "Choose an attachment to preview it here."}
      </div>
    );
  }
  const { message, attachment: a } = selected;
  const url = attachmentUrl(threadId, message.id, a.partId);
  return (
    <>
      <AttachmentViewer open={viewing} onClose={() => setViewing(false)} attachment={a} url={url} downloadUrl={attachmentUrl(threadId, message.id, a.partId, true)} />
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={a.filename}>
          {a.filename}
        </span>
        {/* Open shows the file full-screen inside WorkDesk, with a Back button; Download saves it without leaving
            the app (phones: the share sheet). Both used to navigate away, which left the home-screen app with no
            way back (2026-10-06). */}
        {(isPdf(a) || isImage(a)) && (
          <Button size="sm" onClick={() => setViewing(true)}>
            <Maximize2 size={14} /> Open
          </Button>
        )}
        <SaveButton url={url} downloadUrl={attachmentUrl(threadId, message.id, a.partId, true)} attachment={a} />
      </div>
      <div className={inline ? "p-3" : "scroll-thin min-h-0 flex-1 overflow-y-auto p-4"}>
        {isPdf(a) ? (
          <Suspense fallback={<Loading label="Loading PDF…" />}>
            <PdfPreview url={url} />
          </Suspense>
        ) : isImage(a) ? (
          <img src={url} alt={a.filename} className="mx-auto max-w-full rounded-md border border-line bg-white" />
        ) : (
          <div className="py-16 text-center text-sm text-slate-500">
            <File size={32} className="mx-auto mb-2 text-slate-300" />
            No preview for this file type. Download it to open.
          </div>
        )}
      </div>
    </>
  );
}

// Saves an attachment without leaving the app: phones get the share sheet (Save to Files, WhatsApp, Mail…);
// computers, and phones that can't share files, download it.
async function saveAttachment(url: string, downloadUrl: string, a: EmailAttachment) {
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && typeof navigator.canShare === "function") {
    try {
      // The preview already loaded `url`, so this usually comes from the browser's cache straight away.
      const blob = await (await fetch(url, { credentials: "same-origin" })).blob();
      const file = new window.File([blob], a.filename, { type: blob.type || a.mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // the person closed the share sheet
    }
  }
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = a.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function SaveButton({ url, downloadUrl, attachment }: { url: string; downloadUrl: string; attachment: EmailAttachment }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" disabled={busy} onClick={() => { setBusy(true); void saveAttachment(url, downloadUrl, attachment).finally(() => setBusy(false)); }}>
      <Download size={15} /> Download
    </Button>
  );
}

// A PDF or image full-screen inside WorkDesk, with Back to return to the email (Esc also closes it). Rendered
// in its own top-layer dialog through a portal, so the email sheet's pull-to-close doesn't react to it.
function AttachmentViewer({ open, onClose, attachment: a, url, downloadUrl }: { open: boolean; onClose: () => void; attachment: EmailAttachment; url: string; downloadUrl: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return createPortal(
    <dialog
      ref={ref}
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      tabIndex={-1}
      aria-label={a.filename}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-slate-100 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-line bg-white px-2 py-1.5 sm:px-4">
            <button onClick={onClose} className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg pr-2 text-sm font-medium text-brand-700 hover:bg-slate-50 active:scale-95">
              <ChevronLeft size={20} /> Back
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-ink" title={a.filename}>
              {a.filename}
            </span>
            <SaveButton url={url} downloadUrl={downloadUrl} attachment={a} />
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto p-3 sm:p-6">
            <div className="mx-auto max-w-4xl">
              {isPdf(a) ? (
                <Suspense fallback={<Loading label="Loading PDF…" />}>
                  <PdfPreview url={url} />
                </Suspense>
              ) : (
                <img src={url} alt={a.filename} className="mx-auto max-w-full rounded-md border border-line bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>,
    document.body,
  );
}

// --- Share (user request 2026-10-06) ---
// The phone's share sheet with the email's attachments and its text as the message, so in WhatsApp the files
// arrive with the email as their caption. iOS only opens the sheet straight from the tap, so on touch devices
// the attachments are fetched as soon as the email opens and handed over instantly when Share is tapped.

const SHARE_MAX_BYTES = 25 * 1024 * 1024; // larger attachment sets are shared as text only
const CAPTION_CHARS = 900; // WhatsApp captions are limited; long emails are cut with "…"


function shareText(thread: Thread, m: EmailMessageContent | undefined, attachmentNames: string[], hidden: string[]) {
  // Bold subject and the message only: no From or Date lines (user request 2026-10-06).
  // From the HTML version when there is one, with Settings > Mail > Hidden text removed exactly as the reader
  // does (2026-10-06: the plain-text copy's *bold* marks and joined lines kept a hidden signature in shares).
  const raw = m ? (m.html ? htmlToText(stripSnippetsFromHtml(m.html, hidden).html) : (m.text ?? "")) : thread.snippet;
  let body = stripSnippets(raw, hidden).text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length > CAPTION_CHARS) body = `${body.slice(0, CAPTION_CHARS).trimEnd()}…`;
  return [`*${thread.subject}*`, "", body, ...(attachmentNames.length ? ["", `Attachments: ${attachmentNames.join(", ")}`] : [])].join("\n");
}

type EmailShare = { ready: boolean; preparing: boolean; go: () => void };

function useEmailShare(thread: Thread, messages: EmailMessageContent[], files: Selected[]): EmailShare {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const [prepared, setPrepared] = useState<globalThis.File[] | null>(null);
  // The caption never includes Settings > Mail > Hidden text, so Share waits until that list is on the device.
  const snippets = useSnippets();
  const hidden = (snippets.data ?? []).map((x) => x.text);
  const loaded = messages.length > 0;
  const total = files.reduce((n, f) => n + f.attachment.size, 0);
  const wantFiles = canShare && touch && files.length > 0 && total <= SHARE_MAX_BYTES && typeof navigator.canShare === "function";

  useEffect(() => {
    if (!wantFiles) return;
    let cancelled = false;
    setPrepared(null);
    Promise.all(
      files.map(async ({ message, attachment: a }) => {
        const blob = await (await fetch(attachmentUrl(thread.id, message.id, a.partId), { credentials: "same-origin" })).blob();
        return new window.File([blob], a.filename, { type: blob.type || a.mimeType });
      }),
    )
      .then((list) => !cancelled && setPrepared(navigator.canShare({ files: list }) ? list : []))
      .catch(() => !cancelled && setPrepared([]));
    return () => {
      cancelled = true;
    };
  }, [wantFiles, files, thread.id]);

  const preparing = wantFiles && prepared === null;
  const go = () => {
    const sharedFiles = wantFiles && prepared && prepared.length ? prepared : [];
    // Newest message's text; file names are listed only when the files themselves can't go with it.
    const text = shareText(thread, messages[0], sharedFiles.length ? [] : files.map((f) => f.attachment.filename), hidden);
    if (canShare) {
      navigator
        .share(sharedFiles.length ? { files: sharedFiles, text } : { title: thread.subject, text })
        .catch((e: Error) => e.name !== "AbortError" && showUndo({ message: "Couldn't open the share menu. Try again." }));
      return;
    }
    // No share menu (some computers): copy the email instead.
    navigator.clipboard
      ?.writeText(text)
      .then(() => showUndo({ message: "Email copied. Paste it anywhere." }))
      .catch(() => showUndo({ message: "Couldn't copy the email." }));
  };
  const listReady = snippets.isSuccess || snippets.isError; // a failed list shouldn't block sharing for good
  return { ready: loaded && !preparing && listReady, preparing: loaded && (preparing || !listReady), go };
}

function ShareButton({ share, className }: { share: EmailShare; className: string }) {
  return (
    <button
      onClick={share.go}
      disabled={!share.ready}
      className={cx("inline-flex items-center justify-center text-slate-500 hover:text-ink active:scale-90 active:bg-slate-100 disabled:opacity-50", className)}
      aria-label={share.preparing ? "Preparing attachments to share" : "Share email"}
      title={share.preparing ? "Preparing attachments…" : "Share"}
    >
      {share.preparing ? <Spinner size={18} /> : <Share size={19} />}
    </button>
  );
}
