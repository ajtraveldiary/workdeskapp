// Checklists inside a task (user request 2026-10-07, v2 idea 4): steps such as "Prepare draft → Get signature →
// Issue order → Update service book", ticked one by one. The form edits them (ChecklistEditor), the task
// details card ticks them straight away (ChecklistTicks), and task rows show the progress (ChecklistChip).
import { ListChecks, Plus, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ChecklistItem, Task } from "../../shared/types";
import { useUpdateTask } from "../api";
import { CheckCircle, ErrorNote, cx } from "./ui";

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 36);

export const checklistProgress = (items: ChecklistItem[]) => ({ done: items.filter((i) => i.done).length, total: items.length });

// In the task form: type the steps, tick ones already done, remove or add more.
export function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { id: newId(), text, done: false }]);
    setDraft("");
  };
  const set = (id: string, patch: Partial<ChecklistItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  return (
    <div>
      <span className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
        Checklist
        {items.length > 0 && <span className="text-xs font-normal text-slate-500">{progressText(items)}</span>}
      </span>
      {items.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-2">
              <span className="pt-[7px] pointer-coarse:pt-[5px]">
                <CheckCircle checked={i.done} onToggle={() => set(i.id, { done: !i.done })} label={i.done ? "Mark step not done" : "Mark step done"} />
              </span>
              <StepText
                value={i.text}
                onChange={(text) => set(i.id, { text })}
                onBlur={() => !i.text.trim() && onChange(items.filter((x) => x.id !== i.id))}
                className={cx(i.done && "text-slate-400")}
                label="Step"
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x.id !== i.id))}
                aria-label={`Remove step: ${i.text}`}
                title="Remove step"
                className="mt-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink active:scale-90 pointer-coarse:mt-0.5 pointer-coarse:p-1.5"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <StepText
          value={draft}
          onChange={setDraft}
          onEnter={add}
          placeholder={items.length ? "Add another step" : "Add a step, e.g. Prepare draft"}
          label="New step"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-line px-3 text-sm text-slate-700 enabled:hover:bg-slate-50 active:scale-[0.97] disabled:opacity-50"
        >
          <Plus size={15} /> Add
        </button>
      </div>
    </div>
  );
}

// A step's text box grows to show the whole step on as many lines as it needs (user request 2026-10-07: long
// Malayalam steps were cut off in one-line boxes). A step stays one paragraph: Enter adds the step (new-step
// box) or does nothing, and pasted line breaks become spaces.
function StepText({
  value,
  onChange,
  onEnter,
  onBlur,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`; // + borders
    };
    fit();
    // The width changes as the sheet opens or the phone turns, and with it the number of lines.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault(); // never saves the whole form or breaks the line
        onEnter?.();
      }}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-label={label}
      maxLength={300}
      className={cx(
        "min-w-0 flex-1 resize-none overflow-hidden rounded-lg border border-line bg-white px-3 py-1.5 text-sm leading-5 outline-none [overflow-wrap:anywhere] hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100",
        className,
      )}
    />
  );
}

// In the task details card: tick steps straight away (saved at once).
export function ChecklistTicks({ task }: { task: Task }) {
  const [items, setItems] = useState<ChecklistItem[]>(task.checklist ?? []);
  const update = useUpdateTask();
  if (!items.length) return null;
  const { done, total } = checklistProgress(items);
  const toggle = (id: string) => {
    const before = items;
    const next = items.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    setItems(next);
    update.mutate({ id: task.id, input: { checklist: next } }, { onError: () => setItems(before) });
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-slate-500">
          <ListChecks size={15} /> Checklist
        </span>
        <span className={cx("text-xs", done === total ? "font-medium text-low-ink" : "text-slate-500")}>{progressText(items)}</span>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full rounded-full bg-low transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-2.5 py-1">
            <CheckCircle checked={i.done} onToggle={() => toggle(i.id)} label={i.done ? `Mark not done: ${i.text}` : `Mark done: ${i.text}`} />
            <span className={cx("min-w-0 flex-1 text-sm leading-5 [overflow-wrap:anywhere]", i.done ? "text-slate-400" : "text-ink")}>{i.text}</span>
          </li>
        ))}
      </ul>
      <ErrorNote error={update.error} />
    </div>
  );
}

// On task rows: "2/5" with a checklist icon, green once every step is done. With onClick it is a button that
// opens the task details card, where the steps are ticked (tapping an email task's row opens its email).
export function ChecklistChip({ items, onClick }: { items: ChecklistItem[] | undefined; onClick?: () => void }) {
  if (!items?.length) return null;
  const { done, total } = checklistProgress(items);
  const look = cx("inline-flex items-center gap-1 tabular-nums", done === total ? "font-medium text-low-ink" : "text-slate-500");
  const body = (
    <>
      <ListChecks size={12} className="shrink-0" />
      {done}/{total}
    </>
  );
  if (!onClick) return <span className={look} title={progressText(items)}>{body}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Checklist: ${progressText(items)}. Show steps`}
      title="Show checklist"
      className={cx(look, "rounded-md border border-line bg-white px-1.5 py-px enabled:hover:bg-slate-50 active:scale-[0.97]")}
    >
      {body}
    </button>
  );
}

function progressText(items: ChecklistItem[]) {
  const { done, total } = checklistProgress(items);
  return done === total ? `All ${total} done` : `${done} of ${total} done`;
}
