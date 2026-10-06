import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Tag } from "lucide-react";
import { Link } from "react-router";
import type { Label, Thread } from "../../shared/types";
import { useLabels, useSetThreadLabels } from "../api";
import { Button, Loading, PopPanel, Spinner, cx, inputClass } from "./ui";

// Gmail labels on an email, in their Gmail colours. Nested labels ("Parent/Child") show their full path.
export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      title={label.name}
      style={label.backgroundColor ? { backgroundColor: label.backgroundColor, color: label.textColor ?? "#000" } : undefined}
      className={cx("inline-flex max-w-36 items-center truncate rounded px-1.5 py-px text-caption2 leading-4 font-medium", !label.backgroundColor && "bg-slate-200 text-slate-700", className)}
    >
      {label.name}
    </span>
  );
}

// ids may be missing on data saved by an older version of the app; show nothing rather than fail.
export function LabelChips({ ids, max = 3, className }: { ids: string[] | undefined; max?: number; className?: string }) {
  const labels = useLabels().data?.labels ?? [];
  const shown = (ids ?? []).map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l);
  if (shown.length === 0) return null;
  return (
    <span className={cx("inline-flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.slice(0, max).map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {shown.length > max && <span className="text-caption2 text-slate-500">+{shown.length - max}</span>}
    </span>
  );
}

// Labels replace the old categories (user request 2026-10-06): they are the user's Gmail labels everywhere.

// Form field for things without an email (tasks made by hand, reports): tap labels on or off; saved with the
// form and kept in WorkDesk only.
export function LabelField({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const labels = useLabels().data?.labels;
  if (!labels) return <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner size={16} /> Loading labels…</p>;
  if (labels.length === 0)
    return (
      <p className="text-sm text-slate-500">
        No labels yet. <Link to="/settings#mail" className="font-medium text-brand-700 underline">Create labels</Link>
      </p>
    );
  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((l) => {
        const on = value.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
            className={cx("inline-flex items-center gap-1 rounded-full border px-1 py-0.5 transition active:scale-[0.97]", on ? "border-brand-500 ring-1 ring-brand-500" : "border-line opacity-70 hover:opacity-100")}
          >
            {on && <Check size={12} strokeWidth={3} className="ml-0.5 text-brand-600" />}
            <LabelChip label={l} />
          </button>
        );
      })}
    </div>
  );
}

// "All labels" filter for task and email lists.
// chip: a small rounded filter button (Emails page toolbar, 2026-10-06), tinted while a label is chosen. It opens
// a menu (an action sheet on phones) rather than the native picker, whose 16px text iOS needs would not fit.
export function LabelFilter({ value, onChange, chip }: { value: string; onChange: (id: string) => void; chip?: boolean }) {
  const labels = useLabels().data?.labels ?? [];
  if (chip) return <LabelFilterChip value={value} onChange={onChange} labels={labels} />;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} w-auto! min-w-0 max-w-52 sm:max-w-none`} aria-label="Label filter">
      <option value="">All labels</option>
      {labels.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

function LabelFilterChip({ value, onChange, labels }: { value: string; onChange: (id: string) => void; labels: Label[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const current = labels.find((l) => l.id === value);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={current ? `Label filter: ${current.name}` : "Label filter"}
        className={cx(
          "inline-flex h-8 max-w-40 min-w-0 items-center gap-1 rounded-full border pr-2 pl-3 text-footnote font-medium active:scale-[0.97] pointer-coarse:h-9",
          current ? "border-brand-200 bg-tint text-brand-800" : "border-line bg-white text-slate-600 hover:border-slate-300",
        )}
      >
        <span className="truncate">{current ? current.name.split("/").at(-1) : "Labels"}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>
      {open && (
        <PopPanel onClose={() => setOpen(false)} title="Show emails with label" className="absolute right-0 z-30 mt-1 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-1 shadow-xl">
          <ul className="scroll-thin max-h-72 overflow-y-auto">
            <li>
              <button onClick={() => pick("")} className={item} aria-pressed={!value}>
                <Check size={15} className={cx("shrink-0 text-brand-600", value && "invisible")} /> All labels
              </button>
            </li>
            {labels.map((l) => (
              <li key={l.id}>
                <button onClick={() => pick(l.id)} className={item} aria-pressed={l.id === value}>
                  <Check size={15} className={cx("shrink-0 text-brand-600", l.id !== value && "invisible")} />
                  <LabelChip label={l} />
                </button>
              </li>
            ))}
          </ul>
        </PopPanel>
      )}
    </div>
  );
}

// Add or remove the user's Gmail labels on this conversation (changes Gmail too). Each tap applies at once.
// Also used on email rows and in the task form for tasks made from an email.
export function LabelPicker({ thread, selected, onChange, compact }: { thread: Pick<Thread, "id">; selected: string[]; onChange: (ids: string[]) => void; compact?: boolean }) {
  const { data } = useLabels();
  const setLabels = useSetThreadLabels();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (id: string) => {
    const on = selected.includes(id);
    const next = on ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next);
    setLabels.mutate({ id: thread.id, add: on ? [] : [id], remove: on ? [id] : [] }, { onError: () => onChange(selected) });
  };

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Labels" aria-label="Labels">
        <Tag size={15} /> <span className={compact ? "sr-only" : "hidden sm:inline"}>Labels</span>
      </Button>
      {open && (
        <PopPanel onClose={() => setOpen(false)} title="Labels" className="absolute right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-1 shadow-xl">
          <p className="px-3 pt-2 pb-1 text-xs text-slate-500">Labels on this email (changes Gmail too)</p>
          {!data ? (
            <Loading className="py-4" />
          ) : !data.canEdit ? (
            <p className="px-3 py-3 text-sm text-slate-600">
              <a href="/api/auth/google" className="font-medium text-brand-700 underline">Sign in again</a> to let WorkDesk change labels.
            </p>
          ) : data.labels.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">No labels yet.</p>
          ) : (
            <ul className="scroll-thin max-h-72 overflow-y-auto">
              {data.labels.map((l) => {
                const on = selected.includes(l.id);
                return (
                  <li key={l.id}>
                    <button onClick={() => toggle(l.id)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" aria-pressed={on}>
                      <span className={cx("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <LabelChip label={l} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {setLabels.error && <p className="px-3 py-2 text-xs text-urgent-ink">{setLabels.error.message}</p>}
          <Link to="/settings#mail" className="mt-1 block border-t border-line px-3 py-2 text-footnote font-medium text-brand-700 hover:bg-slate-50">
            Manage labels
          </Link>
        </PopPanel>
      )}
    </div>
  );
}
