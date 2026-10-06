// Full-screen email viewer: the conversation on one side, the selected attachment (PDF or image) on the other.
// On phones and tablets the email comes first and the attachment preview follows it further down the same
// scroll (user request 2026-10-06). Content comes from Gmail on demand and is never stored in WorkDesk's database.
import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Download, ExternalLink, File, FileText, Image as ImageIcon, ListPlus, Paperclip, Tag, X } from "lucide-react";
import type { EmailAttachment, EmailMessageContent, Thread } from "../../shared/types";
import { gmailThreadUrl } from "../../shared/gmailUrl";
import { attachmentUrl, useDismiss, useEmailContent, useLabels, useMarkRead, useSetThreadLabels } from "../api";
import { formatDateTime } from "../format";
import { Avatar } from "./Avatar";
import { EmailStatusTags } from "./EmailStatus";
import { LabelChip, LabelChips } from "./LabelChips";
import { Link } from "react-router";
import { SnoozeMenu } from "./ThreadRow";
import { Button, cx } from "./ui";

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
    if (thread && !d.open) d.showModal();
    if (!thread && d.open) d.close();
  }, [thread]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={thread?.subject ?? "Email"}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-white p-0 sm:m-auto sm:h-[min(100dvh-2rem,60rem)] sm:w-[min(100vw-2rem,84rem)] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
    >
      {thread && <ViewerBody key={thread.id} thread={thread} onClose={onClose} onCreateTask={onCreateTask} />}
    </dialog>
  );
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
      {/* Header: subject, sender and the usual email actions */}
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
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
        <section className="scroll-thin min-h-0 overflow-y-auto px-4 py-4 sm:px-5" aria-label="Email">
          {isPending ? (
            <p className="py-16 text-center text-sm text-slate-500">Loading email…</p>
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
            <HtmlBody html={message.html} cids={cids} />
          ) : (
            <div className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">{message.text || "(No text in this message)"}</div>
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
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={a.filename}>
          {a.filename}
        </span>
        {(isPdf(a) || isImage(a)) && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[0.8125rem] font-medium text-slate-700 hover:border-slate-300 pointer-coarse:h-9">
            <ExternalLink size={15} /> Open
          </a>
        )}
        <a href={attachmentUrl(threadId, message.id, a.partId, true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[0.8125rem] font-medium text-slate-700 hover:border-slate-300 pointer-coarse:h-9">
          <Download size={15} /> Download
        </a>
      </div>
      <div className={inline ? "p-3" : "scroll-thin min-h-0 flex-1 overflow-y-auto p-4"}>
        {isPdf(a) ? (
          <Suspense fallback={<p className="py-10 text-center text-sm text-slate-500">Loading PDF…</p>}>
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

// Add or remove the user's Gmail labels on this conversation (changes Gmail too). Each tap applies at once.
function LabelPicker({ thread, selected, onChange }: { thread: Thread; selected: string[]; onChange: (ids: string[]) => void }) {
  const { data } = useLabels();
  const setLabels = useSetThreadLabels();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (id: string) => {
    const on = selected.includes(id);
    const next = on ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next);
    setLabels.mutate({ id: thread.id, add: on ? [] : [id], remove: on ? [id] : [] }, { onError: () => onChange(selected) });
  };

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Labels">
        <Tag size={15} /> <span className="hidden sm:inline">Labels</span>
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-1 shadow-xl">
          <p className="px-3 pt-2 pb-1 text-xs text-slate-500">Labels on this email (changes Gmail too)</p>
          {!data ? (
            <p className="px-3 py-3 text-sm text-slate-500">Loading…</p>
          ) : !data.canEdit ? (
            <p className="px-3 py-3 text-sm text-slate-600">
              <a href="/api/auth/google" className="font-medium text-brand-700 underline">Sign in again</a> to let WorkDesk change labels.
            </p>
          ) : data.labels.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">No labels yet.</p>
          ) : (
            <ul className="scroll-thin max-h-72 overflow-y-auto">
              {data.labels.map((l) => {
                const on = selected.includes(l.id);
                return (
                  <li key={l.id}>
                    <button onClick={() => toggle(l.id)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" aria-pressed={on}>
                      <span className={cx("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <LabelChip label={l} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {setLabels.error && <p className="px-3 py-2 text-xs text-urgent-ink">{setLabels.error.message}</p>}
          <Link to="/settings#mail" className="mt-1 block border-t border-line px-3 py-2 text-[0.8125rem] font-medium text-brand-700 hover:bg-slate-50">
            Manage labels
          </Link>
        </div>
      )}
    </div>
  );
}
