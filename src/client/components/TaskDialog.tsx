import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChecklistItem, Priority, Task, Thread } from "../../shared/types";
import { findDueDate } from "../../shared/findDates";
import { useCreateTask, useCreateTaskFromThread, useEmailContent, useMe, useUpdateTask } from "../api";
import { addDays, formatDay } from "../format";
import { htmlToText } from "../snippets";
import { ChecklistEditor } from "./Checklist";
import { Hourglass } from "lucide-react";
import { canWait, isWaiting } from "./Waiting";
import { NO_RELATED, TitleWithRelated, type RelatedValue } from "./Related";
import { Button, ErrorNote, Field, Modal, Spinner, inputClass } from "./ui";

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
  const initial =
    mode.kind === "edit"
      ? mode.task
      : mode.kind === "fromThread"
        ? // From an email (user request 2026-10-06): the user types the title; the note is the email's subject.
          { title: "", notes: mode.thread.subject, dueDate: null, dueTime: null, priority: "normal" as Priority }
        : { title: "", notes: "", dueDate: mode.dueDate ?? null, dueTime: null, priority: "normal" as Priority };
  // Tasks have no labels (user request 2026-10-06); emails keep theirs.

  const [title, setTitle] = useState(initial.title);
  const [dueDate, setDueDate] = useState(initial.dueDate ?? "");
  const [dueTime, setDueTime] = useState(initial.dueTime ?? "");
  const [priority, setPriority] = useState<Priority>(initial.priority);
  const [notes, setNotes] = useState(initial.notes);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(mode.kind === "edit" ? (mode.task.checklist ?? []) : []);
  // Waiting for a reply (user request 2026-10-07), with the optional day a reply is expected by.
  const [waiting, setWaiting] = useState(mode.kind === "edit" ? isWaiting(mode.task) : false);
  const [replyBy, setReplyBy] = useState(mode.kind === "edit" && isWaiting(mode.task) ? (mode.task.replyBy ?? "") : "");
  const waitAllowed = mode.kind !== "edit" || canWait(mode.task);
  // What it is about: an employee, a designation or the office (Staff, user request 2026-10-07).
  const [related, setRelated] = useState<RelatedValue>(mode.kind === "edit" ? { relatedKind: mode.task.relatedKind, relatedId: mode.task.relatedId } : NO_RELATED);

  // From an email: a date written in the newest message becomes the due date, unless the user has already
  // set or cleared one (user request 2026-10-06). The email usually comes from the cache (it was just open).
  const email = useEmailContent(mode.kind === "fromThread" ? mode.thread : null);
  const dateTouched = useRef(false);
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    const newest = email.data?.messages.at(-1);
    if (!newest) return;
    const body = newest.html ? htmlToText(newest.html) : (newest.text ?? "");
    const date = findDueDate(body, today);
    setFound(date);
    if (date && !dateTouched.current) setDueDate(date);
  }, [email.data, today]);
  const pickDate = (d: string) => {
    dateTouched.current = true;
    setDueDate(d);
  };
  const lookingForDate = mode.kind === "fromThread" && email.isPending;

  const create = useCreateTask();
  const fromThread = useCreateTaskFromThread();
  const update = useUpdateTask();
  const pending = create.isPending || fromThread.isPending || update.isPending;
  const error = create.error ?? fromThread.error ?? update.error;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const steps = checklist.map((i) => ({ ...i, text: i.text.trim() })).filter((i) => i.text);
    const wait = waitAllowed ? { waiting, replyBy: (waiting && replyBy) || null } : {};
    const input = { title, notes, dueDate: dueDate || null, dueTime: (dueDate && dueTime) || null, priority, checklist: steps, ...wait, ...related };
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
        {/* The person icon at the end of the box: what the task is about (Staff, user request 2026-10-07). */}
        <TitleWithRelated value={related} onChange={setRelated}>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            placeholder={mode.kind === "fromThread" ? "What needs to be done?" : undefined}
          />
        </TitleWithRelated>
      </Field>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Due date">
          <input type="date" className={inputClass} value={dueDate} onChange={(e) => pickDate(e.target.value)} />
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
      {mode.kind === "fromThread" && (lookingForDate || found) && (
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          {lookingForDate ? (
            <>
              <Spinner size={12} /> Looking for a date in the email…
            </>
          ) : found === dueDate ? (
            <>Due date taken from the email ({formatDay(found!, today)}). Change it if needed.</>
          ) : (
            <>
              The email mentions {formatDay(found!, today)}.
              <button type="button" onClick={() => pickDate(found!)} className="font-medium text-brand-700 hover:underline active:scale-[0.97]">
                Use it
              </button>
            </>
          )}
        </p>
      )}
      <div className="-mt-2 flex flex-wrap gap-1.5">
        {quickDates.map((q) => (
          <button
            type="button"
            key={q.label}
            onClick={() => pickDate(q.value)}
            className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 pointer-coarse:py-1"
          >
            {q.label}
          </button>
        ))}
        {dueDate && (
          <button type="button" onClick={() => { pickDate(""); setDueTime(""); }} className="px-2 py-0.5 text-xs text-slate-500 hover:underline pointer-coarse:py-1">
            No date
          </button>
        )}
      </div>
      {waitAllowed && (
        <div className="rounded-lg border border-line px-3 py-2.5">
          <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} className="size-4 accent-[var(--color-snooze)]" />
            <Hourglass size={15} className="text-snooze" aria-hidden />
            Waiting for a reply
          </label>
          {waiting && (
            <div className="mt-2.5">
              <Field label="Reply expected by (optional)">
                <input type="date" className={inputClass} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
              </Field>
              <p className="mt-1.5 text-xs text-slate-500">The task stays under Waiting, out of your to-do list. With a date, it comes back to Today on that day.</p>
            </div>
          )}
        </div>
      )}
      <Field label="Notes">
        <textarea
          className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <ChecklistEditor items={checklist} onChange={setChecklist} />
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
