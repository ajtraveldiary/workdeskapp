import { useState, type FormEvent } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useCategories, useCategoryActions, useMe } from "../api";
import { formatDateTime } from "../format";
import { Button, Card, ErrorNote, PageHeader, inputClass } from "../components/ui";

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
      <PageHeader title="Settings" />
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
                  <dd className="text-red-700">{me.account.lastSyncError}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="mt-1 text-sm text-slate-600">No Gmail account connected.</p>
          )}
          <p className="mt-3 flex gap-2 text-sm text-slate-600">
            <ShieldCheck size={18} className="shrink-0 text-brand-700" />
            Read-only access. Dismissing an email or completing a task only changes WorkDesk; nothing is deleted, archived,
            labelled or marked read in Gmail.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Categories</h2>
          <p className="mt-1 text-sm text-slate-600">Sections or responsibilities used to sort emails and tasks.</p>
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                {c.name}
                <button
                  onClick={() => confirm(`Remove "${c.name}"? Emails and tasks keep working, they just lose this category.`) && remove.mutate(c.id)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
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
