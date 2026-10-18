// Settings › Assistant (MCP server, user request 2026-10-18; docs/MCP_PLAN.md): connect ChatGPT or Gemini to read
// WorkDesk. Shows the address to paste into the assistant, what it can read (everything but saved passwords; it
// can't change anything yet), the assistants connected now with Disconnect, and the assistant log — every tool call
// they made, kept apart from History (user's choice 2026-10-18).
import { useState } from "react";
import { Bot, Check, CircleAlert, Copy, Unplug } from "lucide-react";
import type { AssistantInfo } from "../../shared/types";
import { olderAssistantLog, useAssistant, useDisconnectAssistant } from "../api";
import { formatDateTime } from "../format";
import { Button, Card, ErrorNote, Loading, cx } from "./ui";

type LogEntry = AssistantInfo["log"][number];

// "query: SPARK · limit: 10" — the arguments a tool was called with.
const argsText = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");

export function AssistantSettings() {
  const { data, error } = useAssistant();
  const disconnect = useDisconnectAssistant();
  const [copied, setCopied] = useState(false);
  const [older, setOlder] = useState<{ log: LogEntry[]; more: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const local = data ? /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(data.url) : false;
  const copy = () => {
    if (!data) return;
    void navigator.clipboard?.writeText(data.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const log = [...(data?.log ?? []), ...(older?.log ?? [])];
  const more = older ? older.more : !!data?.more;
  const loadOlder = async () => {
    const last = log.at(-1);
    if (!last) return;
    setLoadingOlder(true);
    try {
      const r = await olderAssistantLog(last.createdAt);
      setOlder((o) => ({ log: [...(o?.log ?? []), ...r.log], more: r.more }));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <Bot size={18} className="text-brand-700" /> Assistant
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Let ChatGPT or Gemini read your WorkDesk, so you can ask things like “what is overdue?”, “summarise the PDF in the HMIS email” or “who retires this year?”. It can
          read everything — emails and attachments, tasks, reminders, events, employees, registers, files, History — except saved website passwords. It can’t change
          anything.
        </p>
        <ErrorNote error={error ?? disconnect.error} />
        {!data && !error ? (
          <Loading className="py-4" />
        ) : data ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly value={data.url} onFocus={(e) => e.currentTarget.select()} aria-label="Assistant connection address" className="h-10 min-w-0 flex-1 basis-60 rounded-lg border border-line bg-white px-3 font-mono text-xs text-slate-600 outline-none focus:border-brand-500" />
              <Button onClick={copy}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {local && (
              <p className="flex items-start gap-1.5 rounded-md bg-high-soft px-3 py-2 text-footnote text-high-ink">
                <CircleAlert size={15} className="mt-0.5 shrink-0" /> This is this computer’s address: assistants can only connect to the published WorkDesk.
              </p>
            )}
            <ul className="list-disc space-y-1 pl-5 text-footnote text-slate-600">
              <li>
                <span className="font-medium text-ink">ChatGPT:</span> Settings → Apps &amp; Connectors → Create (or “Add custom MCP server”), paste the address, choose
                OAuth. ChatGPT opens WorkDesk to sign in: tap Allow.
              </li>
              <li>
                <span className="font-medium text-ink">Gemini:</span> add a custom app (MCP server) with this address. Google offers this only in the US for now.
              </li>
              <li>Assistants read emails as information only; text inside an email can’t give them orders. Disconnect here at any time.</li>
            </ul>

            <div>
              <h3 className="mb-1.5 text-sm font-medium text-ink">Connected</h3>
              {data.connections.length === 0 ? (
                <p className="text-footnote text-slate-500">No assistant is connected.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {data.connections.map((c) => (
                    <li key={c.clientId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{c.name || "Assistant"}</span>
                        <span className="block text-footnote text-slate-500">
                          {c.connectedAt && `Connected ${formatDateTime(c.connectedAt)}`}
                          {c.lastUsedAt && ` · last used ${formatDateTime(c.lastUsedAt)}`}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={disconnect.isPending}
                        onClick={() => confirm(`Disconnect ${c.name || "this assistant"}? It stops reading WorkDesk until you connect it again.`) && disconnect.mutate(c.clientId)}
                      >
                        <Unplug size={14} /> Disconnect
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Assistant log</h2>
        <p className="mt-1 text-sm text-slate-600">Everything an assistant looked at, newest first. Kept for a year, apart from History.</p>
        {!data && !error ? (
          <Loading className="py-4" />
        ) : log.length === 0 ? (
          <p className="mt-3 text-footnote text-slate-500">Nothing yet.</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {log.map((l) => (
                <li key={l.id} className="px-3 py-2">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className={cx("font-medium", l.ok ? "text-ink" : "text-urgent-ink")}>{l.title}</span>
                    <span className="text-footnote text-slate-500">
                      {l.clientName} · {formatDateTime(l.createdAt)}
                    </span>
                  </span>
                  {Object.keys(l.args).length > 0 && <span className="block text-footnote text-slate-600 [overflow-wrap:anywhere]">{argsText(l.args)}</span>}
                  {!l.ok && l.message && <span className="block text-footnote text-urgent-ink [overflow-wrap:anywhere]">{l.message}</span>}
                </li>
              ))}
            </ul>
            {more && (
              <Button size="sm" variant="ghost" className="mt-2" disabled={loadingOlder} onClick={() => void loadOlder()}>
                Show older
              </Button>
            )}
          </>
        )}
      </Card>
    </>
  );
}
