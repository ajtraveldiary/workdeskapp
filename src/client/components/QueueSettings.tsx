// Settings › Queue (user request 2026-10-23, "implement a queue system so that no service gets lost, and let the
// user view it"): what the background queue (src/server/lib/queue.ts) is doing — work waiting, running, paused
// because a run's calls ran out, failed and waiting to be tried again — and what it did lately. Run now runs it at
// once; Retry queues a failed job again.
import { useState } from "react";
import { Play, RotateCw } from "lucide-react";
import { useQueue, useQueueActions } from "../api";
import { JOB_INFO, JOB_MAX_ATTEMPTS } from "../../shared/jobs";
import type { QueueJob, QueueRunReport } from "../../shared/types";
import { formatDateTime } from "../format";
import { Badge, Button, Card, ErrorNote, SkeletonList, Spinner, cx, type Tone } from "./ui";

function statusOf(j: QueueJob): { label: string; tone: Tone } {
  if (j.status === "running") return { label: "Running", tone: "brand" };
  if (j.status === "failed") return { label: "Failed", tone: "urgent" };
  if (j.status === "done") return { label: "Done", tone: "low" };
  if (j.attempts > 0) return { label: "Retrying", tone: "high" };
  if (j.pauses > 0) return { label: "Paused", tone: "snooze" };
  return { label: "Waiting", tone: "info" };
}

function whenOf(j: QueueJob) {
  if (j.status === "running") return j.startedAt ? `Started ${formatDateTime(j.startedAt)}` : "Running";
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

function JobRow({ job, onRetry, retrying }: { job: QueueJob; onRetry?: () => void; retrying?: boolean }) {
  const s = statusOf(job);
  const info = JOB_INFO[job.kind];
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="self-center">
            <Badge tone={s.tone}>{s.label}</Badge>
          </span>
          <span className="font-medium text-ink">{info?.title ?? job.kind}</span>
          <span className="text-footnote text-slate-500">{whenOf(job)}</span>
        </span>
        {job.note && (
          <span className={cx("block text-footnote [overflow-wrap:anywhere]", job.status === "failed" || job.attempts > 0 ? "text-urgent-ink" : "text-slate-600")}>{job.note}</span>
        )}
      </span>
      {onRetry && (
        <Button size="sm" disabled={retrying} onClick={onRetry}>
          {retrying ? <Spinner size={14} /> : <RotateCw size={14} />} Retry
        </Button>
      )}
    </li>
  );
}

const resultWords: Record<QueueRunReport["ran"][number]["result"], string> = { done: "done", paused: "paused", retry: "failed, will retry", failed: "failed" };

export function QueueSettings() {
  const { data, error } = useQueue();
  const { run, retry } = useQueueActions();
  const [last, setLast] = useState<QueueRunReport | null>(null);
  const jobs = data?.jobs ?? [];
  const now = jobs.filter((j) => j.status !== "done");
  const recent = jobs.filter((j) => j.status === "done").slice(0, 30);
  const count = (f: (j: QueueJob) => boolean) => jobs.filter(f).length;
  const waiting = count((j) => j.status === "queued");
  const running = count((j) => j.status === "running");
  const failed = count((j) => j.status === "failed");

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="font-semibold text-slate-900">Background queue</h2>
          <Button
            size="sm"
            variant="primary"
            disabled={run.isPending}
            onClick={() => run.mutate(undefined, { onSuccess: (r) => setLast(r) })}
          >
            {run.isPending ? <Spinner size={14} className="text-white" /> : <Play size={14} />} Run now
          </Button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Gmail sync, phone notifications, Gmail task labels and upkeep run every 10 minutes.{" "}
          {data?.limit
            ? `Each run may make ${data.limit} calls to the database and Gmail (Cloudflare's free plan); work that doesn't fit waits here and carries on in the next run.`
            : "There is no limit on calls here."}{" "}
          Anything that fails is tried again, so nothing is lost.
        </p>
        {data && (
          <p className="mt-2 flex flex-wrap gap-2">
            <Badge tone={waiting ? "info" : "neutral"}>{waiting} waiting</Badge>
            <Badge tone={running ? "brand" : "neutral"}>{running} running</Badge>
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
        <ErrorNote error={run.error ?? retry.error ?? error} />
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Now</h2>
        <p className="mt-1 text-sm text-slate-600">Work waiting, running or failed.</p>
        {!data && !error ? (
          <SkeletonList rows={3} className="mt-3" />
        ) : now.length === 0 ? (
          <p className="mt-3 text-footnote text-slate-500">Nothing waiting. Everything is up to date.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {now.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                onRetry={j.status === "failed" ? () => retry.mutate(j.id, { onSuccess: (r) => setLast(r) }) : undefined}
                retrying={retry.isPending && retry.variables === j.id}
              />
            ))}
          </ul>
        )}
      </Card>

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
