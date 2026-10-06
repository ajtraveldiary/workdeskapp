import { useState } from "react";
import { useSearchParams } from "react-router";
import type { EmailState, Thread } from "../../shared/types";
import { useBulkDismiss, useThreads } from "../api";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { ThreadRow } from "../components/ThreadRow";
import { EmailViewer } from "../components/EmailViewer";
import { Button, Card, Empty, PageHeader, SearchInput, SkeletonList, Tabs } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";
import { LabelFilter } from "../components/LabelChips";

type StateTab = EmailState | "all";

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const state = (params.get("state") as StateTab) ?? "needs_decision";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [unread, setUnread] = useState(false);
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  const [viewing, setViewing] = useState<Thread | null>(null);
  const { data, error, isFetching } = useThreads({ state, q, unread, label });
  const bulkDismiss = useBulkDismiss();

  const threads = data?.threads ?? [];
  const counts = data?.counts ?? {};
  const inQueue = state === "needs_decision";

  const setState = (s: StateTab) => {
    setSelected(new Set());
    setParams(s === "needs_decision" ? {} : { state: s });
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <PageHeader title="Emails" subtitle="Every email here needs a decision: make it a task, snooze it, or dismiss it. Deciding never changes Gmail; opening an email marks it read there." actions={<RefreshButton keys={[["threads"], ["summary"]]} sync label="Check Gmail and refresh emails" />} />

      <Tabs<StateTab>
        value={state}
        onChange={setState}
        options={[
          { value: "needs_decision", label: "Needs decision", count: counts.needs_decision },
          { value: "snoozed", label: "Snoozed", count: counts.snoozed },
          { value: "task", label: "Converted to task" },
          { value: "dismissed", label: "Dismissed" },
          { value: "all", label: "All" },
        ]}
      />

      {/* Compact (user request 2026-10-06): filters and Select all share a row. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search sender, subject…" />
        <LabelFilter value={label} onChange={setLabel} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} className="size-4 accent-brand-700 pointer-coarse:size-5" />
          Unread
        </label>
        {inQueue && threads.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 accent-brand-700 pointer-coarse:size-5"
              checked={selected.size > 0 && selected.size === threads.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(threads.map((t) => t.id)) : new Set())}
            />
            {selected.size ? `${selected.size} selected` : "Select all"}
          </label>
        )}
        {inQueue && selected.size > 0 && (
          <Button size="sm" disabled={bulkDismiss.isPending} onClick={() => bulkDismiss.mutate([...selected], { onSuccess: () => setSelected(new Set()) })}>
            Dismiss selected
          </Button>
        )}
        {isFetching && <span className="text-xs text-slate-400">Updating…</span>}
      </div>

      {error && <p className="text-urgent-ink">{error.message}</p>}
      <Card>
        {!data && !error ? (
          <SkeletonList />
        ) : threads.length === 0 ? (
          <Empty title={inQueue ? "Nothing waiting for a decision" : "No emails here"}>
            {inQueue ? "New email from Gmail appears here until you decide what to do with it." : undefined}
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {threads.map((t: Thread) => (
              <ThreadRow
                key={t.id}
                thread={t}
               
                selected={selected.has(t.id)}
                onSelect={inQueue ? (on) => toggle(t.id, on) : undefined}
                onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })}
                onOpen={setViewing}
              />
            ))}
          </ul>
        )}
      </Card>

      <EmailViewer
        thread={viewing}
        onClose={() => setViewing(null)}
        onCreateTask={(thread) => {
          setViewing(null);
          setDialog({ kind: "fromThread", thread });
        }}
      />
      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
