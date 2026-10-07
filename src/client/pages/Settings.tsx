import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CalendarDays, Copy, Check, ChevronRight, EyeOff, History as HistoryIcon, ListChecks, Moon, Sun, SunMoon, Pencil, RefreshCw, Scissors, ShieldCheck, Tag, Trash2, X } from "lucide-react";
import { useCalendarLink, useCalendarLinkActions, useLabelActions, useLabels, useMe, useMutedSenderActions, useMutedSenders, useSetTaskLabelSettings, useSnippetActions, useSnippets, useTaskLabelSettings } from "../api";
import { LABEL_COLORS, type LabelColor } from "../../shared/labelColors";
import type { Label } from "../../shared/types";
import { LabelChip } from "../components/LabelChips";
import { normalizeSenderPattern } from "../../shared/schemas";
import { formatDateTime } from "../format";
import { Button, Card, ErrorNote, Loading, PageHeader, Segmented, cx, inputClass } from "../components/ui";
import { onThemeChoice, setThemeChoice, themeChoice, type ThemeChoice } from "../theme";
import { RefreshButton } from "../components/RefreshButton";

export function SettingsPage() {
  const me = useMe().data;
  return (
    <>
      <PageHeader title="Settings" actions={<RefreshButton keys={[["me"], ["muted-senders"], ["snippets"], ["labels"], ["task-label-settings"], ["calendar-link"]]} label="Refresh settings" />} />
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

        <Appearance />

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
            and managing your own labels (below and in the email viewer). Removing an email or completing a task only
            changes WorkDesk; nothing is ever deleted, archived or sent.
          </p>
        </Card>

        <MailSettings />

        <CalendarLink />

        <p className="text-xs text-slate-500">
          {/* The title shows the version only for its first 5 seconds (user request 2026-10-07), so it is here too. */}
          WorkDesk v{__APP_VERSION__} · Signed in as {me?.email} · Dates use {me?.timezone}
        </p>
      </div>
    </>
  );
}

// Settings > Appearance (user request 2026-10-07): Automatic follows the iPhone's or computer's own setting.
// Saved on this device only, like the screen brightness.
function Appearance() {
  const [choice, setChoice] = useState<ThemeChoice>(themeChoice);
  useEffect(() => onThemeChoice(setChoice), []);
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : SunMoon;
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <Icon size={18} className="text-brand-700" /> Appearance
      </h2>
      <p className="mt-1 mb-3 text-sm text-slate-600">
        {choice === "auto" ? "Light or dark to match this device's own setting." : choice === "dark" ? "Dark colours, easier on the eyes at night." : "Light colours all the time."}
      </p>
      <Segmented<ThemeChoice>
        value={choice}
        onChange={setThemeChoice}
        oneRow
        options={[
          { value: "auto", label: "Automatic" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
    </Card>
  );
}

// Settings > Calendar (user request 2026-10-07): a private link that puts WorkDesk's tasks and reminders in
// Apple Calendar (or Google Calendar / Outlook). One way and read-only; a new link stops the old one.
function CalendarLink() {
  const { data, error } = useCalendarLink();
  const { make, off } = useCalendarLinkActions();
  const [copied, setCopied] = useState(false);
  const url = data?.url ?? null;
  const webcal = url?.replace(/^https?:/, "webcal:");
  const copy = () => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Card className="p-5">
      <h2 id="calendar" className="flex scroll-mt-24 items-center gap-2 font-semibold text-slate-900">
        <CalendarDays size={18} className="text-brand-700" /> Calendar
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        See your tasks and reminders in Apple Calendar on your iPhone, iPad or Mac (Google Calendar and Outlook work too). The calendar app shows a copy:
        tick off and edit things here in WorkDesk.
      </p>
      <ErrorNote error={error ?? make.error ?? off.error} />
      {!data && !error ? (
        <Loading className="py-4" />
      ) : !url ? (
        <Button variant="primary" className="mt-3" disabled={make.isPending} onClick={() => make.mutate()}>
          <CalendarDays size={16} /> Create calendar link
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <a
              href={webcal}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700 active:scale-[0.97] pointer-coarse:h-9"
            >
              <CalendarDays size={16} /> Add to Apple Calendar
            </a>
            <Button onClick={copy}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar link" className={cx(inputClass, "font-mono text-xs text-slate-600")} />
          <ul className="list-disc space-y-1 pl-5 text-footnote text-slate-600">
            <li>
              <span className="font-medium text-ink">iPhone:</span> tap Add to Apple Calendar, then Subscribe. Or Settings → Calendar → Accounts → Add Account → Other → Add
              Subscribed Calendar, and paste the link.
            </li>
            <li>Shows open tasks with a due date (at their time, or all day) and every reminder date from two months back to a year ahead; done reminder dates get a ✓.</li>
            <li>Calendar apps check for changes on their own, usually every 15 minutes to an hour on iPhone (Google Calendar: every few hours).</li>
            <li>Anyone with this link can see your task titles. Keep it private; Make new link stops the old one.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={make.isPending}
              onClick={() => confirm("Make a new link? Calendars using the old link stop updating until you add the new one.") && make.mutate()}
            >
              <RefreshCw size={14} /> Make new link
            </Button>
            <Button size="sm" variant="danger" disabled={off.isPending} onClick={() => confirm("Turn off the calendar link? Calendars using it stop updating.") && off.mutate()}>
              <X size={14} /> Turn off
            </Button>
          </div>
        </div>
      )}
    </Card>
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
        const moved = [
          r.toSections && `${r.toSections} ${r.toSections === 1 ? "email" : "emails"} moved to Other sections`,
          r.fromSections && `${r.fromSections} back in Pending`,
        ].filter(Boolean);
        setNotice(added ? (parts.length ? `Done: ${parts.join(" · ")}.` : "Saved. No emails had this label yet.") : moved.length ? `Saved: ${moved.join(" · ")}.` : "Saved.");
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
    // A label chosen as the task or done label is your own section, not an organising one.
    const organizeLabelIds = id ? (settings.organizeLabelIds ?? []).filter((x) => x !== id) : (settings.organizeLabelIds ?? []);
    apply({ ...settings, organizeLabelIds, [which]: id }, !!id);
  };

  // Sections (user request 2026-10-07; replaced the "straight to completed" tick boxes): every label is a
  // section of the office except the ones ticked here as only for organising mail.
  const toggleOrganise = (id: string, on: boolean) => {
    if (!settings) return;
    const organizeLabelIds = on ? [...(settings.organizeLabelIds ?? []), id] : (settings.organizeLabelIds ?? []).filter((x) => x !== id);
    apply({ ...settings, organizeLabelIds }, false);
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
          <legend className="block text-sm font-medium text-ink">Sections of the office</legend>
          <span className="mt-0.5 block text-xs text-slate-500">
            Your labels are sections: the two above are yours (pending and completed work). Any other label means
            another section has the email, so it skips Pending and shows under Emails › Other sections, never as your
            task. A new reply brings it back to Pending. Tick the labels that are only for organising mail, not sections.
          </span>
          <div className="mt-1.5 grid gap-x-3 sm:grid-cols-2">
            {list.map((l) => {
              const isTask = l.id === settings?.taskLabelId;
              const isDone = l.id === settings?.doneLabelId;
              const organise = !!(settings?.organizeLabelIds ?? []).includes(l.id);
              return (
                <label key={l.id} className={cx("flex min-h-11 items-center gap-2.5 rounded-lg px-1.5", isTask || isDone ? "opacity-60" : "has-[:enabled]:cursor-pointer has-[:enabled]:hover:bg-slate-50")}>
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5"
                    checked={organise}
                    disabled={!settings || !labels?.canEdit || save.isPending || isTask || isDone}
                    onChange={(e) => toggleOrganise(l.id, e.target.checked)}
                    aria-label={`${l.name}: only for organising`}
                  />
                  <LabelChip label={l} className="max-w-full" />
                  <span className="text-xs text-slate-500">{isTask ? "your section" : isDone ? "your completed" : organise ? "organising only" : "other section"}</span>
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
