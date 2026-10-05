import { useState, type FormEvent } from "react";
import type { Priority, Task, Thread } from "../../shared/types";
import { useCategories, useCreateTask, useCreateTaskFromThread, useMe, useUpdateTask } from "../api";
import { addDays } from "../format";
import { Button, ErrorNote, Field, Modal, inputClass } from "./ui";

export type TaskDialogMode = { kind: "new"; dueDate?: string } | { kind: "fromThread"; thread: Thread } | { kind: "edit"; task: Task };

export function TaskDialog({ mode, onClose }: { mode: TaskDialogMode | null; onClose: () => void }) {
  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      title={mode?.kind === "edit" ? "Edit task" : mode?.kind === "fromThread" ? "Create task from email" : "New task"}
    >
      {mode && <TaskForm key={mode.kind === "edit" ? mode.task.id : mode.kind} mode={mode} onDone={onClose} />}
    </Modal>
  );
}

function TaskForm({ mode, onDone }: { mode: TaskDialogMode; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const categories = useCategories().data ?? [];
  const initial =
    mode.kind === "edit"
      ? mode.task
      : mode.kind === "fromThread"
        ? { title: mode.thread.subject, notes: "", dueDate: null, dueTime: null, priority: "normal" as Priority, categoryId: mode.thread.categoryId }
        : { title: "", notes: "", dueDate: mode.dueDate ?? null, dueTime: null, priority: "normal" as Priority, categoryId: null };

  const [title, setTitle] = useState(initial.title);
  const [dueDate, setDueDate] = useState(initial.dueDate ?? "");
  const [dueTime, setDueTime] = useState(initial.dueTime ?? "");
  const [priority, setPriority] = useState<Priority>(initial.priority);
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [notes, setNotes] = useState(initial.notes);

  const create = useCreateTask();
  const fromThread = useCreateTaskFromThread();
  const update = useUpdateTask();
  const pending = create.isPending || fromThread.isPending || update.isPending;
  const error = create.error ?? fromThread.error ?? update.error;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { title, notes, dueDate: dueDate || null, dueTime: (dueDate && dueTime) || null, priority, categoryId: categoryId || null };
    if (mode.kind === "edit") await update.mutateAsync({ id: mode.task.id, input });
    else if (mode.kind === "fromThread") await fromThread.mutateAsync({ threadId: mode.thread.id, input });
    else await create.mutateAsync(input);
    onDone();
  };

  const quickDates = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "In a week", value: addDays(today, 7) },
  ];

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode.kind === "fromThread" && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          From <span className="font-medium text-slate-800">{mode.thread.fromName ?? mode.thread.fromEmail}</span>. The
          task stays linked to this email, and nothing changes in Gmail.
        </p>
      )}
      <Field label="Task">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Due date">
          <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Time (optional)">
          <input type="time" className={inputClass} value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
        </Field>
        <Field label="Priority">
          <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="normal">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
      </div>
      <div className="-mt-2 flex flex-wrap gap-1.5">
        {quickDates.map((q) => (
          <button
            type="button"
            key={q.label}
            onClick={() => setDueDate(q.value)}
            className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 pointer-coarse:px-3.5 pointer-coarse:py-2 pointer-coarse:text-sm"
          >
            {q.label}
          </button>
        ))}
        {dueDate && (
          <button type="button" onClick={() => { setDueDate(""); setDueTime(""); }} className="px-2 py-0.5 text-xs text-slate-500 hover:underline pointer-coarse:py-2 pointer-coarse:text-sm">
            No date
          </button>
        )}
      </div>
      <Field label="Category">
        <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <textarea
          className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {mode.kind === "edit" ? "Save" : "Create task"}
        </Button>
      </div>
    </form>
  );
}
