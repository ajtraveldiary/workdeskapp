// Settings › Queue (user request 2026-10-23, "implement a queue system so that no service gets lost, and let the
// user view it"): what the background queue (src/server/lib/queue.ts) is doing — work waiting, running, paused
// because a run's calls ran out, failed and waiting to be tried again — and what it did lately. Run now runs it at
// once; Retry queues a failed job again. Changes that failed are saved here too (tried again on their own, or
// waiting for your check when part of them was saved), and the Calls log lists every outgoing call each request
// or 10-minute run made (user request 2026-10-23, "every subrequest … must be logged in this queue").
import { useState } from "react";
import { ChevronDown, ChevronRight, Play, RotateCw, Trash2 } from "lucide-react";
import { api, callLogPath, useCallLog, useQueue, useQueueActions, type CallLogFilter } from "../api";
import { JOB_INFO, JOB_MAX_ATTEMPTS } from "../../shared/jobs";
import type { CallEntry, CallLog, QueueJob, QueueRunReport } from "../../shared/types";
import { formatDateTime } from "../format";
import { Badge, Button, Card, ErrorNote, Segmented, SkeletonList, Spinner, cx, type Tone } from "./ui";

function statusOf(j: QueueJob): { label: string; tone: Tone } {
  if (j.status === "running") return { label: "Running", tone: "brand" };
  if (j.status === "failed") return { label: "Failed", tone: "urgent" };
  if (j.status === "check") return { label: "Needs your check", tone: "high" };
  if (j.status === "done") return { label: "Done", tone: "low" };
  if (j.attempts > 0) return { label: "Retrying", tone: "high" };
  if (j.pauses > 0) return { label: "Paused", tone: "snooze" };
  return { label: "Waiting", tone: "info" };
}

function whenOf(j: QueueJob) {
  if (j.status === "running") return j.startedAt ? `Started ${formatDateTime(j.startedAt)}` : "Running";
  if (j.status === "check") return `Saved ${formatDateTime(j.createdAt)}`;
  if (j.status === "queued") {
    const later = new Date(j.runAfter).getTime() > Date.now();
    const parts = [later ? `Next try ${formatDateTime(j.runAfter)}` : "Waiting for the next run"];
    if (j.attempts > 0) parts.push(`try ${j.attempts + 1} of ${JOB_MAX_ATTEMPTS}`);
    if (j.pauses > 0) parts.push(`paused ${j.pauses === 1 ? "once" : `${j.pauses} times`}`);
    return parts.join(" · ");
  }
  const parts = [formatDateTime(j.finishedAt ?? j.updatedAt)];
  if (j.calls) parts.push(`${j.calls} calls`);
  if (j.ranBy) parts.push(j.ranBy === "schedule" ? "every 10 minutes" : "from the app");
  return parts.join(" · ");
}

function JobRow({ job, onRetry, onDiscard, busy }: { job: QueueJob; onRetry?: () => void; onDiscard?: () => void; busy?: boolean }) {
  const s = statusOf(job);
  const info = JOB_INFO[job.kind];
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-3 py-2">
      {/* At least 16rem for the text, so on phones the buttons go under it instead of squeezing it. */}
      <span className="min-w-0 flex-1 basis-64">
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="self-center">
            <Badge tone={s.tone}>{s.label}</Badge>
          </span>
          <span className="font-medium text-ink [overflow-wrap:anywhere]">{job.title || info?.title || job.kind}</span>
          <span className="text-footnote text-slate-500">{whenOf(job)}</span>
        </span>
        {job.request && <span className="block text-footnote text-slate-500 [overflow-wrap:anywhere]">{job.request}</span>}
        {job.note && (
          <span className={cx("block text-footnote [overflow-wrap:anywhere]", job.status === "failed" || job.attempts > 0 ? "text-urgent-ink" : job.status === "check" ? "text-high-ink" : "text-slate-600")}>
            {job.note}
          </span>
        )}
      </span>
      {(onRetry || onDiscard) && (
        <span className="flex flex-wrap gap-2">
          {onRetry && (
            <Button size="sm" disabled={busy} onClick={onRetry}>
              {busy ? <Spinner size={14} /> : <RotateCw size={14} />} Retry
            </Button>
          )}
          {onDiscard && (
            <Button size="sm" variant="danger" disabled={busy} onClick={onDiscard}>
              <Trash2 size={14} /> Discard
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

const resultWords: Record<QueueRunReport["ran"][number]["result"], string> = { done: "done", paused: "paused", retry: "failed, will retry", failed: "failed" };

export function QueueSettings() {
  const { data, error } = useQueue();
  const { run, retry, discard } = useQueueActions();
  const [last, setLast] = useState<QueueRunReport | null>(null);
  const jobs = data?.jobs ?? [];
  const now = jobs.filter((j) => j.status !== "done");
  const recent = jobs.filter((j) => j.status === "done").slice(0, 30);
  const count = (f: (j: QueueJob) => boolean) => jobs.filter(f).length;
  const waiting = count((j) => j.status === "queued");
  const running = count((j) => j.status === "running");
  const failed = count((j) => j.status === "failed");
  const check = count((j) => j.status === "check");
  const busyId = (retry.isPending && retry.variables) || (discard.isPending && discard.variables) || null;

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="font-semibold text-slate-900">Background queue</h2>
          <Button size="sm" variant="primary" disabled={run.isPending} onClick={() => run.mutate(undefined, { onSuccess: (r) => setLast(r) })}>
            {run.isPending ? <Spinner size={14} className="text-white" /> : <Play size={14} />} Run now
          </Button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Gmail sync, phone notifications, Gmail task labels and upkeep run every 10 minutes.{" "}
          {data?.limit
            ? `Each run or request may make ${data.limit} calls to the database and Gmail (Cloudflare's free plan); work that doesn't fit waits here and carries on in the next run.`
            : "There is no limit on calls here."}{" "}
          A change of yours that fails is saved here and tried again, and anything that fails is retried, so nothing is lost.
        </p>
        {data && (
          <p className="mt-2 flex flex-wrap gap-2">
            <Badge tone={waiting ? "info" : "neutral"}>{waiting} waiting</Badge>
            <Badge tone={running ? "brand" : "neutral"}>{running} running</Badge>
            {check > 0 && <Badge tone="high">{check} need your check</Badge>}
            <Badge tone={failed ? "urgent" : "neutral"}>{failed} failed</Badge>
          </p>
        )}
        {last && (
          <p className="mt-2 text-footnote text-slate-600 [overflow-wrap:anywhere]">
            {last.ran.length
              ? `This run: ${last.ran.map((r) => `${JOB_INFO[r.kind]?.title ?? r.kind} ${resultWords[r.result]} (${r.note})`).join(" · ")}${last.more ? ". More is waiting — Run now again to carry on." : "."}`
              : "Nothing was due; the queue is up to date."}
          </p>
        )}
        <ErrorNote error={run.error ?? retry.error ?? discard.error ?? error} />
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Now</h2>
        <p className="mt-1 text-sm text-slate-600">Work waiting, running, failed or waiting for your check.</p>
        {!data && !error ? (
          <SkeletonList rows={3} className="mt-3" />
        ) : now.length === 0 ? (
          <p className="mt-3 text-footnote text-slate-500">Nothing waiting. Everything is up to date.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {now.map((j) => {
              const open = j.status === "failed" || j.status === "check";
              return (
                <JobRow
                  key={j.id}
                  job={j}
                  onRetry={open ? () => retry.mutate(j.id, { onSuccess: (r) => setLast(r) }) : undefined}
                  onDiscard={open ? () => discard.mutate(j.id) : undefined}
                  busy={busyId === j.id}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <CallsLog />

      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Recently done</h2>
        <p className="mt-1 text-sm text-slate-600">Kept for 2 days; failed work for 30 days.</p>
        {!data && !error ? (
          <SkeletonList rows={4} className="mt-3" />
        ) : recent.length === 0 ? (
          <p className="mt-3 text-footnote text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {recent.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const KIND_LABEL: Record<CallEntry["kind"], string> = { db: "Database", gmail: "Gmail", google: "Google", push: "Push", other: "Other" };
const SOURCE_LABEL: Record<CallLog["source"], string> = { app: "From the app", schedule: "Every 10 minutes", assistant: "Assistant" };

// Every outgoing call per request or run, newest first; tap one to see its calls.
function CallsLog() {
  const [filter, setFilter] = useState<CallLogFilter>({ failedOnly: false, selfChecks: false });
  const { data, error } = useCallLog(filter);
  const [older, setOlder] = useState<{ calls: CallLog[]; more: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...(data?.calls ?? []), ...(older?.calls ?? [])];
  const more = older ? older.more : data?.more;
  const change = (f: Partial<CallLogFilter>) => {
    setFilter((x) => ({ ...x, ...f }));
    setOlder(null);
  };
  const loadOlder = async () => {
    const lastRow = rows.at(-1);
    if (!lastRow) return;
    setLoadingOlder(true);
    try {
      const r = await api<{ calls: CallLog[]; more: boolean }>(callLogPath(filter, lastRow.startedAt));
      setOlder((o) => ({ calls: [...(o?.calls ?? []), ...r.calls], more: r.more }));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="font-semibold text-slate-900">Calls log</h2>
        <Segmented<"all" | "failed">
          value={filter.failedOnly ? "failed" : "all"}
          onChange={(v) => change({ failedOnly: v === "failed" })}
          oneRow
          options={[
            { value: "all", label: "All" },
            { value: "failed", label: "Failed only" },
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Every call to the database, Gmail, Google and phone notification services, by request. Database calls show only
        what kind of query they were, never your data. Kept 2 days; requests with a failed call 30 days.
      </p>
      <label className="mt-2 flex w-fit items-center gap-2 text-footnote text-slate-600">
        <input type="checkbox" checked={filter.selfChecks} onChange={(e) => change({ selfChecks: e.target.checked })} />
        Show the queue's own checks
      </label>
      {!data && !error ? (
        <SkeletonList rows={4} className="mt-3" />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-footnote text-slate-500">{filter.failedOnly ? "No failed calls." : "Nothing logged yet."}</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {rows.map((r) => (
              <CallLogRow key={r.id} row={r} open={open === r.id} onToggle={() => setOpen((o) => (o === r.id ? null : r.id))} />
            ))}
          </ul>
          {more && (
            <Button size="sm" variant="ghost" className="mt-2" disabled={loadingOlder} onClick={() => void loadOlder()}>
              Show older
            </Button>
          )}
        </>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}

function CallLogRow({ row, open, onToggle }: { row: CallLog; open: boolean; onToggle: () => void }) {
  const share = row.limit ? Math.min(100, Math.round((row.calls / row.limit) * 100)) : 0;
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-start gap-2 px-3 py-2 text-left enabled:hover:bg-slate-50">
        {open ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-500" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-500" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium text-ink [overflow-wrap:anywhere]">{row.title}</span>
            {row.failed > 0 && (
              <span className="self-center">
                <Badge tone="urgent">{row.failed} failed</Badge>
              </span>
            )}
            {row.ranOut && (
              <span className="self-center">
                <Badge tone="high">Calls ran out</Badge>
              </span>
            )}
            {row.jobId && (
              <span className="self-center">
                <Badge tone="info">Saved to queue</Badge>
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-slate-500">
            <span>{formatDateTime(row.startedAt)}</span>
            <span>{SOURCE_LABEL[row.source]}</span>
            <span>
              {row.calls}
              {row.limit ? ` of ${row.limit}` : ""} calls · {row.ms} ms
            </span>
            {row.limit && (
              <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <span className={cx("block h-full rounded-full", share >= 90 ? "bg-urgent" : share >= 70 ? "bg-high" : "bg-brand-600")} style={{ width: `${share}%` }} />
              </span>
            )}
          </span>
          {row.title !== row.request && <span className="block text-footnote text-slate-400 [overflow-wrap:anywhere]">{row.request}</span>}
        </span>
      </button>
      {open && (
        <ol className="space-y-1 border-t border-line bg-slate-50/60 px-3 py-2">
          {row.entries.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-footnote">
              <span className={cx("font-medium", e.ok ? "text-low-ink" : "text-urgent-ink")}>{e.ok ? "✓" : "✕"}</span>
              <span className="text-slate-500">{KIND_LABEL[e.kind]}</span>
              <span className="text-ink [overflow-wrap:anywhere]">{e.what}</span>
              <span className="text-slate-400">
                +{e.at} ms · {e.ms} ms{e.status ? ` · ${e.status}` : ""}
              </span>
              {(e.job || e.inner) && <span className="text-slate-500 [overflow-wrap:anywhere]">{[e.job, e.inner].filter(Boolean).join(" · ")}</span>}
              {e.error && <span className="basis-full text-urgent-ink [overflow-wrap:anywhere]">{e.error}</span>}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
