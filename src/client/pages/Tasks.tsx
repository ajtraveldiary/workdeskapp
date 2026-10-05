import { useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import type { TaskView } from "../../shared/types";
import { useCategories, useTasks } from "../api";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { TaskRow } from "../components/TaskRow";
import { Button, Card, Empty, PageHeader, SearchInput, Tabs, inputClass } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

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
  const [category, setCategory] = useState("");
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  const categories = useCategories().data ?? [];
  const { data, error, isFetching } = useTasks({ view, q, category });

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
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass} w-auto`} aria-label="Category filter">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {isFetching && <span className="text-xs text-slate-400">Updating…</span>}
      </div>

      {error && <p className="text-urgent-ink">{error.message}</p>}
      <Card>
        {!data || data.tasks.length === 0 ? (
          <Empty title={EMPTY[view]} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.tasks.map((t) => (
              <TaskRow key={t.id} task={t} today={data.today} categories={categories} onEdit={(task) => setDialog({ kind: "edit", task })} />
            ))}
          </ul>
        )}
      </Card>

      <TaskDialog mode={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
