import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Check, ChevronRight, EyeOff, History as HistoryIcon, ListChecks, Pencil, RefreshCw, Scissors, ShieldCheck, Tag, Trash2, X } from "lucide-react";
import { useLabelActions, useLabels, useMe, useMutedSenderActions, useMutedSenders, useSetTaskLabelSettings, useSnippetActions, useSnippets, useTaskLabelSettings } from "../api";
import { LABEL_COLORS, type LabelColor } from "../../shared/labelColors";
import type { Label } from "../../shared/types";
import { LabelChip } from "../components/LabelChips";
import { normalizeSenderPattern } from "../../shared/schemas";
import { formatDateTime } from "../format";
import { Button, Card, ErrorNote, Loading, PageHeader, cx, inputClass } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

export function SettingsPage() {
  const me = useMe().data;
  return (
    <>
      <PageHeader title="Settings" actions={<RefreshButton keys={[["me"], ["muted-senders"], ["snippets"], ["labels"], ["task-label-settings"]]} label="Refresh settings" />} />
      <div className="space-y-6">
        {/* Phones: History moved here from the bottom bar (user request 2026-10-06); wider screens keep it in the side rail. */}
        <Link
          to="/history"
          className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-sm active:scale-[0.99] md:hidden"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <HistoryIcon size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink">History</span>
            <span className="block truncate text-footnote text-slate-500">Every task and email decision, with undo</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-slate-400" />
        </Link>

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
        <HiddenText />
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <TaskLabels />
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <GmailLabels />
      </div>
    </Card>
  );
}

// Settings > Mail > Hidden text (user request 2026-10-06): repeated text such as signatures and disclaimers,
// left out of the email reader (with "Show hidden text" under the email) and of shared emails.
function HiddenText() {
  const snippets = useSnippets().data ?? [];
  const { add, remove } = useSnippetActions();
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim().length >= 3) add.mutate(value.trim(), { onSuccess: () => setValue("") });
  };
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <Scissors size={15} className="text-slate-500" /> Hidden text
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Text that repeats in many emails, like signatures and "Don't print" footers. It is left out when you read or share an
        email; "Show hidden text" under the email brings it back. Spacing, line breaks and capitals don't need to match. Gmail
        isn't changed.
      </p>
      {snippets.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
          {snippets.map((x) => (
            <li key={x.id} className="flex items-start gap-3 px-3 py-2 text-sm">
              <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-line text-slate-700">{x.text}</span>
              <button
                onClick={() => remove.mutate(x.id)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink pointer-coarse:p-2"
                aria-label="Stop hiding this text"
                title="Stop hiding this text"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-3 space-y-2">
        <textarea
          className="min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={"Paste text to hide, e.g.\nRegards,\nDistrict Medical Office (Health)\nPh: 0471-2471291"}
          aria-label="Text to hide in emails"
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={value.trim().length < 3 || add.isPending}>
            Hide this text
          </Button>
        </div>
      </form>
      <ErrorNote error={add.error} />
    </div>
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
        <p className="mt-2 rounded-lg bg-snooze-soft px-3 py-2 text-footnote text-snooze-ink">
          To add, edit or remove labels from WorkDesk,{" "}
          <a href="/api/auth/google" className="font-medium underline">
            sign in again
          </a>{" "}
          and allow the extra Gmail permission.
        </p>
      )}

      {labels.length === 0 ? (
        data ? <p className="mt-3 text-sm text-slate-500">No labels in Gmail yet.</p> : <Loading className="py-6" />
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
            className={cx("flex size-6 items-center justify-center rounded-full transition hover:scale-110 active:scale-90 pointer-coarse:size-8", on && "ring-2 ring-brand-600 ring-offset-1")}
          >
            {on && <Check size={12} strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

// Settings > Mail > Tasks and labels: a Gmail label for emails that become tasks, another for completed ones.
function TaskLabels() {
  const labels = useLabels().data;
  const settings = useTaskLabelSettings().data;
  const save = useSetTaskLabelSettings();
  const [notice, setNotice] = useState<string | null>(null);
  const list = labels?.labels ?? [];
  const nameOf = (id: string | null) => list.find((l) => l.id === id)?.name ?? "";

  const apply = (next: NonNullable<typeof settings>, added: boolean, made = "task") => {
    setNotice(null);
    save.mutate(next, {
      onSuccess: (r) => {
        const parts = [
          r.created && `${r.created} ${made}${r.created === 1 ? "" : "s"} created`,
          r.completed && `${r.completed} completed`,
          r.queued && `${r.queued} more being fetched from Gmail (they'll appear after the next syncs)`,
          r.labelled && `${r.labelled} ${r.labelled === 1 ? "email" : "emails"} labelled in Gmail`,
          r.toLabel && `${r.toLabel} more will be labelled over the next syncs`,
        ].filter(Boolean);
        setNotice(added ? (parts.length ? `Done: ${parts.join(" · ")}.` : "Saved. No emails had this label yet.") : "Saved.");
      },
    });
  };

  const change = (which: "taskLabelId" | "doneLabelId", id: string | null) => {
    if (!settings) return;
    if (id) {
      const what =
        which === "taskLabelId"
          ? `Every email labelled "${nameOf(id)}" in Gmail will become a task, and every email that is a task (already, or later) will get this label in Gmail.`
          : `Every email labelled "${nameOf(id)}" in Gmail will become a completed task, and every email whose task is completed (already, or later) will get this label in Gmail.`;
      if (!confirm(`${what}\n\nEmails not in WorkDesk yet are fetched over the next few syncs. Continue?`)) return;
    }
    // A label chosen as the done label no longer needs its tick below.
    const autoDoneLabelIds = which === "doneLabelId" && id ? (settings.autoDoneLabelIds ?? []).filter((x) => x !== id) : (settings.autoDoneLabelIds ?? []);
    apply({ ...settings, autoDoneLabelIds, [which]: id }, !!id);
  };

  // Tick boxes: labels whose emails go straight to completed tasks (user request 2026-10-06).
  const toggleStraight = (id: string, on: boolean) => {
    if (!settings) return;
    if (on) {
      const gmail = settings.doneLabelId ? ` They also get "${nameOf(settings.doneLabelId)}" in Gmail.` : "";
      if (!confirm(`Every email labelled "${nameOf(id)}" in Gmail (already, or later) will become a completed task in WorkDesk, without going through Pending or your to-do list.${gmail}\n\nEmails not in WorkDesk yet are fetched over the next few syncs. Continue?`)) return;
    }
    const autoDoneLabelIds = on ? [...(settings.autoDoneLabelIds ?? []), id] : (settings.autoDoneLabelIds ?? []).filter((x) => x !== id);
    apply({ ...settings, autoDoneLabelIds }, on, "completed task");
  };

  const picker = (which: "taskLabelId" | "doneLabelId", label: string, help: string) => {
    const other = which === "taskLabelId" ? settings?.doneLabelId : settings?.taskLabelId;
    return (
      <label className="block">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{help}</span>
        <select
          className={`${inputClass} mt-1.5`}
          aria-label={label}
          value={settings?.[which] ?? ""}
          disabled={!settings || !labels?.canEdit || save.isPending}
          onChange={(e) => change(which, e.target.value || null)}
        >
          <option value="">Don't use a label</option>
          {list.map((l) => (
            <option key={l.id} value={l.id} disabled={l.id === other}>
              {l.name}
              {l.id === other ? " (used for the other one)" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <ListChecks size={15} className="text-slate-500" /> Tasks and Gmail labels
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Keep Gmail and your tasks in step. Every email that is a task gets the first label in Gmail, and every email
        whose task is completed gets the second, including tasks you made before choosing the labels. Choosing a
        label also brings in every email that already has it, and adding the label to an email later (in Gmail or
        here) does the same.
      </p>
      {labels && !labels.canEdit && (
        <p className="mt-2 rounded-lg bg-snooze-soft px-3 py-2 text-footnote text-snooze-ink">
          <a href="/api/auth/google" className="font-medium underline">
            Sign in again
          </a>{" "}
          to let WorkDesk label emails in Gmail.
        </p>
      )}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {picker("taskLabelId", "Label for emails that become tasks", "Its emails are tasks in WorkDesk.")}
        {picker("doneLabelId", "Label for emails whose task is completed", "Replaces the task label when the task is done.")}
      </div>
      {list.length > 0 && (
        <fieldset className="mt-4">
          <legend className="block text-sm font-medium text-ink">Labels that go straight to completed tasks</legend>
          <span className="mt-0.5 block text-xs text-slate-500">
            Emails with a ticked label become completed tasks right away, without going through Pending or your to-do list.
          </span>
          <div className="mt-1.5 grid gap-x-3 sm:grid-cols-2">
            {list.map((l) => {
              const isTask = l.id === settings?.taskLabelId;
              const isDone = l.id === settings?.doneLabelId;
              const checked = isDone || !!(settings?.autoDoneLabelIds ?? []).includes(l.id);
              return (
                <label key={l.id} className={cx("flex min-h-11 items-center gap-2.5 rounded-lg px-1.5", isTask || isDone ? "opacity-60" : "has-[:enabled]:cursor-pointer has-[:enabled]:hover:bg-slate-50")}>
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5"
                    checked={checked}
                    disabled={!settings || !labels?.canEdit || save.isPending || isTask || isDone}
                    onChange={(e) => toggleStraight(l.id, e.target.checked)}
                  />
                  <LabelChip label={l} className="max-w-full" />
                  {isTask && <span className="text-xs text-slate-500">task label</span>}
                  {isDone && <span className="text-xs text-slate-500">completed label</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {save.isPending && <p className="mt-2 text-xs text-slate-500">Applying… this can take a moment for a busy label.</p>}
      {notice && <p className="mt-2 rounded-lg bg-low-soft px-3 py-2 text-footnote text-low-ink">{notice}</p>}
      <div className="mt-2">
        <ErrorNote error={save.error} />
      </div>
      {list.length === 0 && labels && <p className="mt-2 text-xs text-slate-500">Create labels under Gmail labels below.</p>}
    </div>
  );
}
