import { useState } from "react";
import { useSearchParams } from "react-router";
import type { EmailState, Thread } from "../../shared/types";
import { useBulkDismiss, useCategories, useThreads } from "../api";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { ThreadRow } from "../components/ThreadRow";
import { Button, Card, Empty, PageHeader, SearchInput, Tabs, inputClass } from "../components/ui";

type StateTab = EmailState | "all";

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const state = (params.get("state") as StateTab) ?? "needs_decision";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [unread, setUnread] = useState(false);
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  const categories = useCategories().data ?? [];
  const { data, error, isFetching } = useThreads({ state, q, unread, category });
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
      <PageHeader title="Inbox" subtitle="Every email here needs a decision: make it a task, snooze it, or dismiss it. Gmail itself is never changed." />

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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search sender, subject…" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass} w-auto`} aria-label="Category filter">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-1 text-sm text-slate-600">
          <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} className="accent-brand-700" />
          Unread only
        </label>
        {isFetching && <span className="text-xs text-slate-400">Updating…</span>}
      </div>

      {inQueue && threads.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-3 px-1 text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            <input
              type="checkbox"
              className="size-4 accent-brand-700"
              checked={selected.size > 0 && selected.size === threads.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(threads.map((t) => t.id)) : new Set())}
            />
            {selected.size ? `${selected.size} selected` : "Select all"}
          </label>
          {selected.size > 0 && (
            <Button
              size="sm"
              disabled={bulkDismiss.isPending}
              onClick={() => bulkDismiss.mutate([...selected], { onSuccess: () => setSelected(new Set()) })}
            >
              Dismiss selected
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-red-700">{error.message}</p>}
      <Card>
        {threads.length === 0 ? (
          <Empty title={inQueue ? "Nothing waiting for a decision" : "No emails here"}>
            {inQueue ? "New email from Gmail appears here until you decide what to do with it." : undefined}
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {threads.map((t: Thread) => (
              <ThreadRow
                key={t.id}
                thread={t}
                categories={categories}
                selected={selected.has(t.id)}
                onSelect={inQueue ? (on) => toggle(t.id, on) : undefined}
                onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })}
              />
            ))}
          </ul>
        )}
      </Card>

      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
