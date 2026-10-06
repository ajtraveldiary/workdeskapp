import { useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import type { Task, TaskView } from "../../shared/types";
import { useTasks, useThread } from "../api";
import { EmailViewer } from "../components/EmailViewer";
import { TaskDetails } from "../components/TaskDetails";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { TaskRow } from "../components/TaskRow";
import { Button, Card, Empty, PageHeader, SearchInput, SkeletonList, Tabs } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";
import { LabelFilter } from "../components/LabelChips";

const EMPTY: Record<TaskView, string> = {
  today: "Nothing due today",
  overdue: "Nothing overdue",
  upcoming: "Nothing scheduled ahead",
  nodate: "No undated tasks",
  all: "No open tasks",
  completed: "No completed tasks yet",
  any: "No tasks",
  reports: "No open report tasks",
};

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as TaskView) ?? "all";
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  const { data, error, isFetching } = useTasks({ view, q, label });
  // Tapping a task opens the email it came from, or (for tasks without one) its details.
  const [emailId, setEmailId] = useState<string | null>(null);
  const [details, setDetails] = useState<Task | null>(null);
  const email = useThread(emailId).data ?? null;
  const openTask = (t: Task) => (t.thread ? setEmailId(t.thread.id) : setDetails(t));

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Work taken out of the inbox, plus anything you add yourself."
        actions={
          <>
            <RefreshButton keys={[["tasks"], ["summary"]]} label="Refresh tasks" />
            <Button variant="primary" onClick={() => setDialog({ kind: "new" })}>
              <Plus size={16} /> New task
            </Button>
          </>
        }
      />

      <Tabs<TaskView>
        value={view}
        onChange={(v) => setParams(v === "all" ? {} : { view: v })}
        options={[
          { value: "all", label: "All open" },
          { value: "today", label: "Today" },
          { value: "overdue", label: "Overdue" },
          { value: "upcoming", label: "Upcoming" },
          { value: "nodate", label: "No date" },
          { value: "completed", label: "Completed" },
        ]}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search tasks…" />
        <LabelFilter value={label} onChange={setLabel} />
        {isFetching && <span className="text-xs text-slate-400">Updating…</span>}
      </div>

      {error && <p className="text-urgent-ink">{error.message}</p>}
      <Card>
        {!data && !error ? (
          <SkeletonList />
        ) : !data || data.tasks.length === 0 ? (
          <Empty title={EMPTY[view]} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.tasks.map((t) => (
              <TaskRow key={t.id} task={t} today={data.today} onEdit={(task) => setDialog({ kind: "edit", task })} onOpen={openTask} />
            ))}
          </ul>
        )}
      </Card>

      <EmailViewer
        thread={emailId ? email : null}
        onClose={() => setEmailId(null)}
        onCreateTask={(thread) => {
          setEmailId(null);
          setDialog({ kind: "fromThread", thread });
        }}
      />
      <TaskDetails
        task={details}
        onClose={() => setDetails(null)}
        onEdit={(t) => {
          setDetails(null);
          setDialog({ kind: "edit", task: t });
        }}
      />
      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
