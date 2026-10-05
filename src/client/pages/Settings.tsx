import { useState, type FormEvent } from "react";
import { Check, EyeOff, Pencil, RefreshCw, ShieldCheck, Tag, Trash2, X } from "lucide-react";
import { useCategories, useCategoryActions, useLabelActions, useLabels, useMe, useMutedSenderActions, useMutedSenders } from "../api";
import { LABEL_COLORS, type LabelColor } from "../../shared/labelColors";
import type { Label } from "../../shared/types";
import { LabelChip } from "../components/LabelChips";
import { normalizeSenderPattern } from "../../shared/schemas";
import { formatDateTime } from "../format";
import { Button, Card, ErrorNote, PageHeader, cx, inputClass } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

export function SettingsPage() {
  const me = useMe().data;
  const categories = useCategories().data ?? [];
  const { add, remove } = useCategoryActions();
  const [name, setName] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(name, { onSuccess: () => setName("") });
  };

  return (
    <>
      <PageHeader title="Settings" actions={<RefreshButton keys={[["me"], ["categories"], ["muted-senders"], ["labels"]]} label="Refresh settings" />} />
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Gmail connection</h2>
          {me?.demo ? (
            <p className="mt-1 text-sm text-slate-600">
              Running in demo mode with sample emails. Add Google credentials to <code className="rounded bg-slate-100 px-1">.env</code> to connect Gmail.
            </p>
          ) : me?.account ? (
            <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-slate-500">Account</dt>
              <dd>{me.account.email}</dd>
              <dt className="text-slate-500">Last synced</dt>
              <dd>{me.account.lastSyncAt ? formatDateTime(me.account.lastSyncAt) : "Never"}</dd>
              {me.account.lastSyncError && (
                <>
                  <dt className="text-slate-500">Last error</dt>
                  <dd className="text-urgent-ink">{me.account.lastSyncError}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="mt-1 text-sm text-slate-600">No Gmail account connected.</p>
          )}
          <p className="mt-3 flex gap-2 text-sm text-slate-600">
            <ShieldCheck size={18} className="shrink-0 text-brand-700" />
            WorkDesk reads your Gmail. It changes Gmail only when you ask: marking an email read when you open it here,
            and managing your own labels (below and in the email viewer). Dismissing an email or completing a task only
            changes WorkDesk; nothing is ever deleted, archived or sent.
          </p>
        </Card>

        <MailSettings />

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Categories</h2>
          <p className="mt-1 text-sm text-slate-600">Sections or responsibilities used to sort emails and tasks.</p>
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                {c.name}
                <button
                  onClick={() => confirm(`Remove "${c.name}"? Emails and tasks keep working, they just lose this category.`) && remove.mutate(c.id)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-urgent-ink pointer-coarse:p-2"
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={submit} className="mt-3 flex gap-2">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" />
            <Button type="submit" disabled={!name.trim() || add.isPending}>
              Add
            </Button>
          </form>
          <div className="mt-2">
            <ErrorNote error={add.error} />
          </div>
        </Card>

        <p className="text-xs text-slate-500">
          Signed in as {me?.email} · Dates use {me?.timezone}
        </p>
      </div>
    </>
  );
}

// Settings > Mail: senders whose emails skip Pending (they stay under All emails).
function MailSettings() {
  const senders = useMutedSenders().data ?? [];
  const { add, remove } = useMutedSenderActions();
  const [value, setValue] = useState("");
  const pattern = normalizeSenderPattern(value);
  const invalid = value.trim() !== "" && !pattern;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pattern) add.mutate(pattern, { onSuccess: () => setValue("") });
  };

  return (
    <Card className="p-5">
      <h2 id="mail" className="scroll-mt-24 font-semibold text-slate-900">
        Mail
      </h2>
      <h3 className="mt-3 flex items-center gap-1.5 text-sm font-medium text-ink">
        <EyeOff size={15} className="text-slate-500" /> Hide from Pending
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Emails from these senders skip Pending Emails and aren't counted there. You'll still find them under All emails, tagged
        "Hidden from Pending". Removing a sender brings their emails back.
      </p>

      {senders.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
          {senders.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {s.pattern.startsWith("@") ? (
                  <>
                    Anyone at <span className="font-medium">{s.pattern.slice(1)}</span>
                  </>
                ) : (
                  <span className="font-medium">{s.pattern}</span>
                )}
              </span>
              {s.hidden > 0 && <span className="shrink-0 text-xs text-slate-500">{s.hidden} hidden now</span>}
              <button
                onClick={() => remove.mutate(s.id)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink pointer-coarse:p-2"
                aria-label={`Show emails from ${s.pattern} in Pending again`}
                title="Show in Pending again"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="name@example.com, or @example.com for a whole domain"
          aria-label="Sender to hide from Pending"
          aria-invalid={invalid}
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <Button type="submit" disabled={!pattern || add.isPending}>
          Hide
        </Button>
      </form>
      {invalid ? (
        <p className="mt-1.5 text-xs text-urgent-ink">Enter an email address, or @domain for a whole domain.</p>
      ) : pattern && pattern !== value.trim().toLowerCase() ? (
        <p className="mt-1.5 text-xs text-slate-500">Will hide: {pattern.startsWith("@") ? `anyone at ${pattern.slice(1)}` : pattern}</p>
      ) : null}
      <div className="mt-2">
        <ErrorNote error={add.error} />
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <GmailLabels />
      </div>
    </Card>
  );
}

// Settings > Mail > Gmail labels: the user's own Gmail labels, created / renamed / recoloured / deleted in Gmail.
function GmailLabels() {
  const { data } = useLabels();
  const { reload, create, update, remove } = useLabelActions();
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor | null>({ ...LABEL_COLORS[5] });
  const [editing, setEditing] = useState<string | null>(null);
  const labels = data?.labels ?? [];
  const canEdit = data?.canEdit ?? false;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate({ name: name.trim(), color }, { onSuccess: () => setName("") });
  };

  const confirmDelete = (l: Label) =>
    confirm(`Delete the label "${l.name}" in Gmail?\n\nIt will be removed from every email that has it. The emails themselves are not deleted.`) &&
    remove.mutate(l.id);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Tag size={15} className="text-slate-500" /> Gmail labels
        </h3>
        <Button size="sm" variant="ghost" onClick={() => reload.mutate()} disabled={reload.isPending} title="Read the labels from Gmail again">
          <RefreshCw size={14} className={cx(reload.isPending && "animate-spin")} /> Refresh from Gmail
        </Button>
      </div>
      <p className="mt-1 text-sm text-slate-600">Your labels from Gmail, shown on emails across WorkDesk. Changes here are made in Gmail itself.</p>
      {!canEdit && data && (
        <p className="mt-2 rounded-lg bg-snooze-soft px-3 py-2 text-[13px] text-snooze-ink">
          To add, edit or remove labels from WorkDesk,{" "}
          <a href="/api/auth/google" className="font-medium underline">
            sign in again
          </a>{" "}
          and allow the extra Gmail permission.
        </p>
      )}

      {labels.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{data ? "No labels in Gmail yet." : "Loading…"}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
          {labels.map((l) =>
            editing === l.id ? (
              <LabelEditor
                key={l.id}
                label={l}
                busy={update.isPending}
                onCancel={() => setEditing(null)}
                onSave={(change) => update.mutate({ id: l.id, ...change }, { onSuccess: () => setEditing(null) })}
              />
            ) : (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <LabelChip label={l} className="max-w-full text-xs" />
                </span>
                {canEdit && (
                  <>
                    <button
                      onClick={() => setEditing(l.id)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink pointer-coarse:p-2"
                      aria-label={`Edit ${l.name}`}
                      title="Rename or recolour"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => confirmDelete(l)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-urgent-ink pointer-coarse:p-2"
                      aria-label={`Delete ${l.name}`}
                      title="Delete in Gmail"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New label (use / to nest, e.g. Reports/HMIS)"
              aria-label="New label name"
            />
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Add
            </Button>
          </div>
          <ColorPicker value={color} onChange={setColor} />
        </form>
      )}
      <div className="mt-2">
        <ErrorNote error={create.error ?? update.error ?? remove.error ?? reload.error} />
      </div>
    </div>
  );
}

function LabelEditor({
  label,
  busy,
  onSave,
  onCancel,
}: {
  label: Label;
  busy: boolean;
  onSave: (c: { name?: string; color?: LabelColor }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<LabelColor | null>(
    label.backgroundColor ? { backgroundColor: label.backgroundColor, textColor: label.textColor ?? "#ffffff" } : null,
  );
  const changedColor = !!color && color.backgroundColor !== label.backgroundColor;
  return (
    <li className="space-y-2 bg-canvas-soft px-3 py-3">
      <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Label name" autoFocus />
      {/* Gmail can't clear a colour through WorkDesk, so "no colour" is only offered for new labels. */}
      <ColorPicker value={color} onChange={setColor} allowNone={false} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !name.trim() || (name.trim() === label.name && !changedColor)}
          onClick={() => onSave({ ...(name.trim() !== label.name ? { name: name.trim() } : {}), ...(changedColor ? { color: color! } : {}) })}
        >
          Save
        </Button>
      </div>
    </li>
  );
}

function ColorPicker({ value, onChange, allowNone = true }: { value: LabelColor | null; onChange: (c: LabelColor | null) => void; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pointer-coarse:gap-3" role="radiogroup" aria-label="Label colour">
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label="No colour"
          onClick={() => onChange(null)}
          title="No colour"
          className={cx("flex size-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-400 pointer-coarse:size-8", value === null && "ring-2 ring-brand-600 ring-offset-1")}
        >
          <X size={12} />
        </button>
      )}
      {LABEL_COLORS.map((c) => {
        const on = value?.backgroundColor === c.backgroundColor;
        return (
          <button
            type="button"
            key={c.name}
            role="radio"
            aria-checked={on}
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange({ backgroundColor: c.backgroundColor, textColor: c.textColor })}
            style={{ backgroundColor: c.backgroundColor, color: c.textColor }}
            className={cx("flex size-6 items-center justify-center rounded-full pointer-coarse:size-8", on && "ring-2 ring-brand-600 ring-offset-1")}
          >
            {on && <Check size={12} strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}
