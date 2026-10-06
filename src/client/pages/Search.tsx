import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Search } from "lucide-react";
import type { Task, Thread } from "../../shared/types";
import { useCategories, useTasks, useThread, useThreads } from "../api";
import { TaskDetails } from "../components/TaskDetails";
import { TaskDialog, type TaskDialogMode } from "../components/TaskDialog";
import { TaskRow } from "../components/TaskRow";
import { ThreadRow } from "../components/ThreadRow";
import { EmailViewer } from "../components/EmailViewer";
import { Card, Empty, PageHeader } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const [dialog, setDialog] = useState<TaskDialogMode | null>(null);
  const [viewing, setViewing] = useState<Thread | null>(null);
  // Tapping a task opens the email it came from, or (for tasks without one) its details.
  const [emailId, setEmailId] = useState<string | null>(null);
  const [details, setDetails] = useState<Task | null>(null);
  const taskEmail = useThread(emailId).data ?? null;
  const openTask = (t: Task) => (t.thread ? setEmailId(t.thread.id) : setDetails(t));
  const categories = useCategories().data ?? [];
  const threads = useThreads({ state: "all", q }, !!q);
  const tasks = useTasks({ view: "any", q }, !!q);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setParams(draft.trim() ? { q: draft.trim() } : {});
  };

  const emailList = q ? (threads.data?.threads ?? []) : [];
  const taskList = q ? (tasks.data?.tasks ?? []) : [];

  return (
    <>
      <PageHeader title="Search" subtitle={q ? `Results for “${q}”` : "Search across emails and tasks."} actions={<RefreshButton keys={[["threads"], ["tasks"]]} label="Refresh results" />} />
      <form onSubmit={submit} className="relative mb-6 max-w-xl">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Sender, subject, task title, notes…"
          className="h-11 w-full rounded-xl border border-line bg-white pr-3 pl-10 text-sm focus:border-brand-200"
        />
      </form>

      {q && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-medium text-slate-600">Tasks ({taskList.length})</h2>
            <Card>
              {taskList.length === 0 ? (
                <Empty title="No matching tasks" />
              ) : (
                <ul className="divide-y divide-line">
                  {taskList.map((t) => (
                    <TaskRow key={t.id} task={t} today={tasks.data!.today} categories={categories} onEdit={(task) => setDialog({ kind: "edit", task })} onOpen={openTask} />
                  ))}
                </ul>
              )}
            </Card>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-medium text-slate-600">Emails ({emailList.length})</h2>
            <Card>
              {emailList.length === 0 ? (
                <Empty title="No matching emails" />
              ) : (
                <ul className="divide-y divide-line">
                  {emailList.map((t: Thread) => (
                    <ThreadRow key={t.id} thread={t} categories={categories} onCreateTask={(thread) => setDialog({ kind: "fromThread", thread })} onOpen={setViewing} />
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      )}

      {/* An email opened from the email results, or the email behind a task result */}
      <EmailViewer
        thread={viewing ?? (emailId ? taskEmail : null)}
        onClose={() => {
          setViewing(null);
          setEmailId(null);
        }}
        onCreateTask={(thread) => {
          setViewing(null);
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
