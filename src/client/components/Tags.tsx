// Tags on tasks and reminders (user request 2026-10-11; user's choices: a colour per tag, compact chips on rows,
// a reminder's tags copied to its tasks, a Tags column in the CSV). A tag is made once and reused: the picker
// offers the most-used ones first and makes a new one from whatever is typed. WorkDesk-only, separate from the
// Gmail labels on emails. Colours: .tag-chip / [data-tag-color] in styles.css.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Check, ListFilter, Pencil, Plus, Tags as TagsIcon, Trash2, X } from "lucide-react";
import type { Tag } from "../../shared/types";
import { MAX_TAGS_PER_ITEM, MAX_TAG_NAME, TAG_COLORS, TAG_COLOR_NAMES, tagKey, tidyTagName, type TagColor } from "../../shared/tags";
import { useTagActions, useTags } from "../api";
import { usePhone } from "./sheet";
import { SortableList } from "./SortableList";
import { Button, Card, ErrorNote, Loading, PopPanel, cx, inputClass } from "./ui";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// --- Chips ---

export function TagChip({ tag, onRemove, className }: { tag: Pick<Tag, "name" | "color">; onRemove?: () => void; className?: string }) {
  return (
    <span data-tag-color={tag.color} title={tag.name} className={cx("tag-chip inline-flex max-w-40 min-w-0 items-center gap-1 rounded-full px-2 py-px text-caption2 leading-4 font-medium", className)}>
      <span className="truncate"># {tag.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove tag ${tag.name}`} className="-mr-1 shrink-0 rounded-full p-0.5 opacity-70 hover:opacity-100 active:scale-90">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

// A row's tags: compact, at most `max` (2 on phones) then "+N".
export function TagChips({ ids, max = 3, className }: { ids: string[] | undefined; max?: number; className?: string }) {
  const all = useTags().data;
  const phone = usePhone();
  if (!ids?.length || !all) return null;
  const shown = ids.map((id) => all.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  if (!shown.length) return null;
  const limit = phone ? Math.min(max, 2) : max;
  return (
    <span className={cx("inline-flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.slice(0, limit).map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {shown.length > limit && (
        <span className="text-caption2 text-slate-500" title={shown.slice(limit).map((t) => t.name).join(", ")}>
          +{shown.length - limit}
        </span>
      )}
    </span>
  );
}

// --- Picker (task and reminder forms) ---

// The tags chosen, with ✕ to take one off; type to find a tag or make a new one; the most-used are one tap away.
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const tags = useTags().data ?? [];
  const { create } = useTagActions();
  const [text, setText] = useState("");
  const chosen = value.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  const name = tidyTagName(text);
  const free = useMemo(
    () => [...tags].filter((t) => !value.includes(t.id)).sort((a, b) => b.tasks + b.reminders - (a.tasks + a.reminders) || a.sortOrder - b.sortOrder),
    [tags, value],
  );
  const matches = name ? free.filter((t) => t.name.toLowerCase().includes(name.toLowerCase())) : free;
  const exact = tags.find((t) => tagKey(t.name) === tagKey(name));
  const full = value.length >= MAX_TAGS_PER_ITEM;

  const add = (id: string) => {
    if (!value.includes(id) && !full) onChange([...value, id]);
    setText("");
  };
  const makeOrAdd = () => {
    if (!name || full) return;
    if (exact) return add(exact.id);
    create.mutate({ name }, { onSuccess: (t) => add(t.id) });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault(); // a tag, not the form
      makeOrAdd();
    } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };

  return (
    <div>
      {chosen.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chosen.map((t) => (
            <TagChip key={t.id} tag={t} onRemove={() => onChange(value.filter((x) => x !== t.id))} className="py-0.5 text-caption" />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className={cx(inputClass, "min-w-0 flex-1")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          maxLength={MAX_TAG_NAME}
          placeholder={full ? `Up to ${MAX_TAGS_PER_ITEM} tags` : tags.length ? "Find or make a tag" : "Make a tag, e.g. Salary"}
          disabled={full}
          aria-label="Find or make a tag"
        />
        {name && !exact && (
          <Button type="button" size="sm" onClick={makeOrAdd} disabled={create.isPending || full} className="pointer-coarse:h-9">
            <Plus size={15} /> Make “{name.length > 14 ? `${name.slice(0, 13)}…` : name}”
          </Button>
        )}
      </div>
      {/* Existing tags, most used first: tap to add (while typing, only the ones that match). */}
      {matches.length > 0 && !full && (
        <div className="mt-2 flex flex-wrap gap-2">
          {matches.slice(0, name ? 12 : 8).map((t) => (
            <button key={t.id} type="button" onClick={() => add(t.id)} className="rounded-full active:scale-95" aria-label={`Add tag ${t.name}`}>
              <TagChip tag={t} className="py-0.5 text-caption opacity-80 hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
      <ErrorNote error={create.error} />
    </div>
  );
}

// --- Filter (Tasks and Reminders pages) ---

export function TagFilter({ value, onChange, className }: { value: string; onChange: (id: string) => void; className?: string }) {
  const tags = useTags().data ?? [];
  if (!tags.length) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, "w-auto! min-w-0 max-w-44 sm:max-w-none", className)} aria-label="Tag filter">
      <option value="">All tags</option>
      {tags.map((t) => (
        <option key={t.id} value={t.id}>
          # {t.name}
        </option>
      ))}
    </select>
  );
}

// A small filter icon (home Due Today and To-do cards, user request 2026-10-11): a menu of tags; with one chosen the
// icon turns blue with the tag's colour dot. Phones get the menu as a sheet from the bottom (PopPanel).
export function TagFilterButton({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const tags = useTags().data ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const active = tags.find((t) => t.id === value);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 active:bg-slate-100 pointer-coarse:py-2.5";

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={active ? `Filtered by tag ${active.name}. Change filter` : "Filter by tag"}
        title={active ? `Tag: ${active.name}` : "Filter by tag"}
        className={cx(
          "relative flex size-8 items-center justify-center rounded-lg border transition active:scale-90 pointer-coarse:size-9",
          active ? "border-brand-200 bg-tint text-brand-700" : "border-line text-slate-500 hover:bg-slate-50 hover:text-ink aria-expanded:bg-slate-100",
        )}
      >
        <ListFilter size={16} />
        {active && <span data-tag-color={active.color} className="tag-dot absolute -top-1 -right-1 size-2.5 rounded-full ring-2 ring-white" aria-hidden />}
      </button>
      {open && (
        <PopPanel onClose={() => setOpen(false)} title="Filter by tag" className="absolute left-0 z-30 mt-1 max-h-80 w-60 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg">
          <button type="button" onClick={() => pick("")} className={item} aria-pressed={!value}>
            <span className="flex-1">All tasks</span>
            {!value && <Check size={15} className="text-brand-600" />}
          </button>
          {tags.length === 0 ? (
            <p className="px-3 py-2 text-footnote text-slate-500">
              No tags yet. Add them in a task form or in{" "}
              <Link to="/settings#tags" className="font-medium text-brand-700 underline">
                Settings › Tags
              </Link>
              .
            </p>
          ) : (
            tags.map((t) => (
              <button key={t.id} type="button" onClick={() => pick(t.id)} className={item} aria-pressed={value === t.id}>
                <span className="min-w-0 flex-1">
                  <TagChip tag={t} className="py-0.5 text-caption" />
                </span>
                {value === t.id && <Check size={15} className="shrink-0 text-brand-600" />}
              </button>
            ))
          )}
        </PopPanel>
      )}
    </div>
  );
}

// Several tags at once (File register, user request 2026-10-11): a "Tags" button with a menu of tags to tick; items
// with any ticked tag show. The button shows how many are ticked. Phones get the menu as a sheet (PopPanel).
export function TagMultiFilterButton({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const tags = useTags().data ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  // Only ticks of tags that still exist count.
  const ticked = value.filter((id) => tags.some((t) => t.id === id));
  const toggle = (id: string) => onChange(ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]);
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 active:bg-slate-100 pointer-coarse:py-2.5";

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={ticked.length ? `Filter by tags: ${ticked.length} chosen` : "Filter by tags"}
        className={cx(
          "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition active:scale-[0.97] pointer-coarse:h-9",
          ticked.length ? "border-brand-200 bg-tint text-brand-700" : "border-line bg-white text-slate-600 hover:bg-slate-50 hover:text-ink aria-expanded:bg-slate-100",
        )}
      >
        <ListFilter size={16} /> Tags
        {ticked.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-caption2 leading-4 font-semibold text-white tabular-nums">{ticked.length}</span>}
      </button>
      {open && (
        <PopPanel onClose={() => setOpen(false)} title="Filter by tags" className="absolute right-0 z-30 mt-1 max-h-80 w-60 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg">
          {tags.length === 0 ? (
            <p className="px-3 py-2 text-footnote text-slate-500">
              No tags yet. Add them in a file&apos;s form or in{" "}
              <Link to="/settings#tags" className="font-medium text-brand-700 underline">
                Settings › Tags
              </Link>
              .
            </p>
          ) : (
            <>
              {tags.map((t) => {
                const on = ticked.includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => toggle(t.id)} className={item} aria-pressed={on}>
                    <span className={cx("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <TagChip tag={t} className="py-0.5 text-caption" />
                    </span>
                  </button>
                );
              })}
              {ticked.length > 0 && (
                <button type="button" onClick={() => onChange([])} className={cx(item, "border-t border-line text-brand-700")}>
                  Clear tags
                </button>
              )}
            </>
          )}
        </PopPanel>
      )}
    </div>
  );
}

// --- Settings > Tags ---

function ColorDots({ value, onChange }: { value: TagColor; onChange: (c: TagColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Tag colour" className="flex flex-wrap gap-2.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={TAG_COLOR_NAMES[c]}
          title={TAG_COLOR_NAMES[c]}
          onClick={() => onChange(c)}
          data-tag-color={c}
          className="tag-dot flex size-6 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-white active:scale-90 aria-checked:ring-2 aria-checked:ring-slate-400"
        >
          {value === c && <Check size={13} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function TagSettings() {
  const { data: tags, error } = useTags();
  const { create, save, remove, order } = useTagActions();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const [editing, setEditing] = useState<{ id: string; name: string; color: TagColor } | null>(null);
  const exists = !!tags?.find((t) => tagKey(t.name) === tagKey(name));

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!tidyTagName(name) || exists) return;
    create.mutate({ name, color }, { onSuccess: () => setName("") });
  };
  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    save.mutate(editing, { onSuccess: () => setEditing(null) });
  };
  const del = (t: Tag) => {
    const used = [t.tasks && plural(t.tasks, "open task"), t.reminders && plural(t.reminders, "reminder"), t.files && plural(t.files, "file")].filter(Boolean).join(", ");
    if (confirm(`Delete the tag "${t.name}"?${used ? ` It comes off ${used}; they stay.` : ""}`)) remove.mutate(t.id);
  };

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <TagsIcon size={18} className="text-brand-700" /> Tags
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Your own tags for tasks, reminders and files (separate from Gmail labels). Make one here or straight from a task or reminder form; a reminder's tags go on its tasks. Drag to arrange.
      </p>
      <ErrorNote error={error ?? save.error ?? remove.error ?? order.error} />
      {!tags ? (
        <Loading className="py-4" />
      ) : tags.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No tags yet.</p>
      ) : (
        <SortableList items={tags} label={(t) => t.name} onReorder={(ids) => order.mutate(ids)} className="mt-3" rowClassName="py-1.5 pr-2 pl-1.5">
          {(t) =>
            editing?.id === t.id ? (
              <form onSubmit={saveEdit} className="min-w-0 flex-1 space-y-2 py-1">
                <div className="flex flex-wrap items-center gap-2">
                  <input className={cx(inputClass, "min-w-0 flex-1")} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus maxLength={MAX_TAG_NAME} aria-label="Tag name" />
                  <Button size="sm" type="submit" variant="primary" disabled={save.isPending || !tidyTagName(editing.name)}>
                    Save
                  </Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
                <ColorDots value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
              </form>
            ) : (
              <>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <TagChip tag={t} className="py-0.5 text-caption" />
                  <span className="text-footnote text-slate-500">{[t.tasks && plural(t.tasks, "open task"), t.reminders && plural(t.reminders, "reminder"), t.files && plural(t.files, "file")].filter(Boolean).join(" · ") || "Not used"}</span>
                </span>
                <RowButton label={`Edit ${t.name}`} onClick={() => setEditing({ id: t.id, name: t.name, color: t.color })}>
                  <Pencil size={16} />
                </RowButton>
                <RowButton label={`Delete ${t.name}`} onClick={() => del(t)} danger>
                  <Trash2 size={16} />
                </RowButton>
              </>
            )
          }
        </SortableList>
      )}
      <form onSubmit={add} className="mt-4 space-y-2.5 border-t border-line pt-4">
        <div className="flex gap-2">
          <input className={cx(inputClass, "min-w-0 flex-1")} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_TAG_NAME} placeholder="New tag, e.g. Salary" aria-label="New tag name" />
          <Button type="submit" variant="primary" disabled={!tidyTagName(name) || exists || create.isPending}>
            <Plus size={16} /> Add
          </Button>
        </div>
        {exists && <p className="text-footnote text-slate-500">There is already a tag with this name.</p>}
        <ColorDots value={color} onChange={setColor} />
        <ErrorNote error={create.error} />
      </form>
    </Card>
  );
}

function RowButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx("shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 active:scale-90", danger ? "hover:text-urgent-ink" : "hover:text-ink")}
    >
      {children}
    </button>
  );
}
