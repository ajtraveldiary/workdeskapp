// Database paused or unreachable (user request 2026-10-06): says what happened in plain words, links to the
// Neon console to check the free-plan usage, and offers Try again. A pop-up over the app, or a full page when
// WorkDesk can't start at all.
import { Database, ExternalLink, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { clearDbIssue, useDbIssue, type DbIssue } from "../dbStatus";
import { Button, Modal } from "./ui";

const NEON_CONSOLE = "https://console.neon.tech/app/projects";

export function DatabaseIssueDialog() {
  const issue = useDbIssue();
  const qc = useQueryClient();
  const retry = () => {
    clearDbIssue();
    void qc.refetchQueries({ type: "active" });
  };
  return (
    <Modal open={!!issue} onClose={clearDbIssue} title={issue?.code === "database_paused" ? "Database paused" : "Database error"} closeOnBackdrop>
      {issue && <IssueBody issue={issue} onRetry={retry} />}
    </Modal>
  );
}

export function DatabaseIssuePage({ issue, onRetry }: { issue: DbIssue; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas-soft px-4 py-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h1 className="mb-3 text-lg font-medium text-ink">{issue.code === "database_paused" ? "Database paused" : "Database error"}</h1>
        <IssueBody issue={issue} onRetry={onRetry} />
      </div>
    </div>
  );
}

function IssueBody({ issue, onRetry }: { issue: DbIssue; onRetry: () => void }) {
  const paused = issue.code === "database_paused";
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <div className="flex gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-urgent-soft text-urgent-ink">
          <Database size={20} />
        </span>
        <p>
          {paused
            ? "WorkDesk's database (Neon) has stopped answering. This usually means a free-plan monthly limit has been used up."
            : "WorkDesk couldn't reach its database (Neon). It may be paused because a free-plan limit was reached, or Neon may be having a problem."}
        </p>
      </div>
      <div className="rounded-lg bg-slate-50 px-3 py-2.5">
        <p className="font-medium text-ink">Check the usage limit in Neon</p>
        <p className="mt-1 text-footnote text-slate-600">
          Open your WorkDesk project and look at <span className="font-medium">Usage</span>. Free-plan limits each month: about 100 CU-hours of compute, 0.5 GB storage and 5 GB
          network transfer.
        </p>
      </div>
      <p className="text-footnote text-slate-600">
        Nothing is lost: your tasks and reminders are safe, and Gmail is not affected. The database starts again when the limit resets next month, or once the limit is raised in Neon. You
        are not charged on the free plan.
      </p>
      {issue.detail && <p className="select-text rounded-md border border-line px-2.5 py-1.5 font-mono text-xs break-words text-slate-500">{issue.detail}</p>}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button type="button" onClick={onRetry}>
          <RefreshCw size={15} /> Try again
        </Button>
        <a
          href={NEON_CONSOLE}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700 active:scale-[0.97] pointer-coarse:h-9"
        >
          <ExternalLink size={15} /> Open Neon usage
        </a>
      </div>
    </div>
  );
}
