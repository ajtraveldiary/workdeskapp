import { useState, type FormEvent } from "react";
import { EyeOff, ShieldCheck, Trash2, X } from "lucide-react";
import { useCategories, useCategoryActions, useMe, useMutedSenderActions, useMutedSenders } from "../api";
import { normalizeSenderPattern } from "../../shared/schemas";
import { formatDateTime } from "../format";
import { Button, Card, ErrorNote, PageHeader, inputClass } from "../components/ui";
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
      <PageHeader title="Settings" actions={<RefreshButton keys={[["me"], ["categories"], ["muted-senders"]]} label="Refresh settings" />} />
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
            WorkDesk reads your Gmail. The only change it makes there is marking an email read when you open it in
            WorkDesk. Dismissing an email or completing a task only changes WorkDesk; nothing is deleted, archived or
            labelled in Gmail.
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
    </Card>
  );
}
