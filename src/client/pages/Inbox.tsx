import { useState } from "react";
import { useSearchParams } from "react-router";
import type { EmailState, Thread } from "../../shared/types";
import { useThreads } from "../api";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { ThreadRow } from "../components/ThreadRow";
import { EmailBulkBar } from "../components/EmailBulkBar";
import { EmailViewer } from "../components/EmailViewer";
import { Search } from "lucide-react";
import { Button, Card, Empty, Fab, PageHeader, SkeletonList, Spinner, Tabs, cx } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";
import { LabelFilter } from "../components/LabelChips";

type StateTab = EmailState | "all";

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  // Snooze was removed (user request 2026-10-06): an old ?state=snoozed link shows Pending.
  const asked = params.get("state") as StateTab | null;
  const state: StateTab = !asked || asked === "snoozed" ? "needs_decision" : asked;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [unread, setUnread] = useState(false);
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  const [viewing, setViewing] = useState<Thread | null>(null);
  const { data, error, isFetching } = useThreads({ state, q, unread, label });

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
      <PageHeader title="Emails" hideOnPhone subtitle="Every email here needs a decision: make it a task or remove it. Deciding never changes Gmail; opening an email marks it read there." actions={<RefreshButton keys={[["threads"], ["summary"]]} sync label="Check Gmail and refresh emails" />} />

      {/* Emails has no "new" of its own (WorkDesk never sends mail): its + adds a task, as on Home. */}
      <Fab label="New task" onClick={() => setDialog({ kind: "new" })} />

      <Tabs<StateTab>
        value={state}
        onChange={setState}
        options={[
          { value: "needs_decision", label: "Pending", count: counts.needs_decision }, // renamed from "Needs decision" (user request 2026-10-06)
          { value: "task", label: "Converted to task" },
          { value: "dismissed", label: "Removed" }, // was "Dismissed" (user request 2026-10-06)
          { value: "all", label: "All" },
        ]}
      />

      {/* Cleanup (user request 2026-10-06): the search box on its own row, then one row with Select all and the
          Labels / Unread filter chips; ticking an email swaps the chips for the actions. */}
      <div className="relative mb-1.5 sm:w-80">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sender, subject…"
          aria-label="Search emails"
          className="h-9 w-full rounded-lg border border-line bg-white pr-9 pl-9 text-sm outline-none placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {isFetching && <Spinner size={14} className="absolute top-1/2 right-3 -translate-y-1/2" />}
      </div>

      {/* One toolbar for the whole list instead of buttons on every email (user request 2026-10-06). */}
      <EmailBulkBar
        threads={threads}
        selected={selected}
        onSelectedChange={setSelected}
        onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })}
        idle={
          <>
            <LabelFilter value={label} onChange={setLabel} chip />
            <button
              type="button"
              onClick={() => setUnread((u) => !u)}
              aria-pressed={unread}
              className={cx(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-footnote font-medium active:scale-[0.97] pointer-coarse:h-9",
                unread ? "border-brand-200 bg-tint text-brand-800" : "border-line bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              <span className={cx("size-2 rounded-full", unread ? "bg-brand-600" : "border border-slate-400")} aria-hidden />
              Unread
            </button>
          </>
        }
        className="app-sticky sticky top-0 z-10 -mx-3 mb-2 bg-canvas-soft/95 px-4 py-1.5 backdrop-blur sm:-mx-4 sm:px-5 md:top-20 md:-mx-6 md:px-7 lg:-mx-8 lg:px-9"
      />
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
                onSelect={(on) => toggle(t.id, on)}
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
