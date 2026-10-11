// Saved website logins (user request 2026-10-11): the list grouped by website, each login with its user ID and a
// hidden password (Show / Copy), and the add / edit form. Used by the Logins page and an employee's own page.
// The password is fetched only when Show or Copy is tapped (revealPassword) and is never kept in the browser's
// saved data; a shown password hides itself again after 30 seconds.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Eye, EyeOff, KeyRound, Plus, Trash2, UserRound, UsersRound } from "lucide-react";
import type { SiteLogin } from "../../shared/types";
import type { SiteLoginInput } from "../../shared/schemas";
import { revealPassword, useLoginActions, useLogins, useStaff } from "../api";
import { showUndo } from "./SwipeRow";
import { Button, Card, ErrorNote, Field, Modal, cx, inputClass } from "./ui";

const SHOW_FOR = 30_000;
const ROLES = ["DDO", "Section clerk"];

// Copy text that is still being fetched. Safari only allows copying straight from the tap, so the clipboard is
// handed a promise (ClipboardItem) instead of waiting for the password first.
async function copyLater(text: Promise<string>) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })]);
  } else {
    await navigator.clipboard.writeText(await text);
  }
}

// --- List ---

export type LoginFormState = { login: SiteLogin | null; preset?: Partial<SiteLoginInput> } | null;

// Logins grouped by website, each group with its link and a + to add another login for that site.
export function LoginGroups({ logins, onEdit, onAdd }: { logins: SiteLogin[]; onEdit: (l: SiteLogin) => void; onAdd: (preset: Partial<SiteLoginInput>) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, SiteLogin[]>();
    for (const l of logins) m.set(l.website, [...(m.get(l.website) ?? []), l]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [logins]);
  return (
    <div className="space-y-3">
      {groups.map(([website, rows]) => {
        const url = rows.find((r) => r.url)?.url ?? "";
        return (
          <Card key={website} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line bg-slate-50/60 px-3 py-2 sm:px-4">
              <KeyRound size={15} className="shrink-0 text-brand-700" />
              <h2 className="min-w-0 flex-1 truncate font-semibold text-ink">
                {website} <span className="text-footnote font-normal text-slate-500">· {rows.length}</span>
              </h2>
              {url && (
                <a href={url} target="_blank" rel="noreferrer" title={url} className="inline-flex shrink-0 items-center gap-1 rounded text-footnote font-medium text-brand-700 hover:underline active:scale-95">
                  <ExternalLink size={14} /> Open site
                </a>
              )}
              <button
                type="button"
                onClick={() => onAdd({ website, url })}
                aria-label={`Add a ${website} login`}
                title={`Add a ${website} login`}
                className="ml-2 shrink-0 rounded-lg p-1 text-slate-500 hover:bg-white hover:text-ink active:scale-90"
              >
                <Plus size={17} />
              </button>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((l) => (
                <LoginRow key={l.id} login={l} onEdit={() => onEdit(l)} titleBy="assignee" />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

// titleBy: the person or role (Logins page, under its website's heading) or the website (an employee's page).
export function LoginRow({ login: l, onEdit, titleBy }: { login: SiteLogin; onEdit: () => void; titleBy: "assignee" | "website" }) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"id" | "password" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  // A shown password hides itself again.
  useEffect(() => {
    if (shown === null) return setNote(null);
    const t = setTimeout(() => setShown(null), SHOW_FOR);
    return () => clearTimeout(t);
  }, [shown]);
  const flash = (what: "id" | "password") => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const show = async () => {
    if (shown !== null) return setShown(null);
    setBusy(true);
    setError(null);
    try {
      setShown(await revealPassword(l.id, false));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const copyPassword = () => {
    setError(null);
    const password = revealPassword(l.id, true);
    copyLater(password)
      .then(() => {
        flash("password");
        showUndo({ message: "Password copied" });
      })
      // The browser may refuse the clipboard (settings, or an app view that blocks it): show it instead.
      .catch(() =>
        password.then(
          (p) => {
            setShown(p);
            setNote("Couldn't copy here, so it's shown instead. Select it to copy.");
          },
          setError,
        ),
      );
  };
  const copyId = () => void navigator.clipboard?.writeText(l.loginId).then(() => flash("id"));
  const Who = l.employeeId ? UserRound : UsersRound;

  return (
    <li className="row-click px-3 py-2 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-4">
      <div className="flex items-center gap-2">
        <button onClick={onEdit} className="row-link group/title flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-label={`Edit ${l.website} login ${l.loginId || l.assignedTo}`}>
          {titleBy === "website" ? (
            <>
              <KeyRound size={14} className="shrink-0 text-brand-700" />
              <span className="truncate text-subhead font-medium text-ink group-hover/title:text-brand-700">{l.website}</span>
            </>
          ) : (
            <>
              <Who size={14} className="shrink-0 text-slate-400" aria-label={l.employeeId ? "Employee" : "Role"} />
              <span className="truncate text-subhead font-medium text-ink group-hover/title:text-brand-700">{l.assignedTo || "Not assigned"}</span>
            </>
          )}
        </button>
        {titleBy === "website" && l.url && (
          <a href={l.url} target="_blank" rel="noreferrer" title={l.url} aria-label={`Open ${l.website}`} className="shrink-0 rounded p-0.5 text-brand-700 hover:text-brand-800 active:scale-90">
            <ExternalLink size={15} />
          </a>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-footnote">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-slate-500">User ID</span>
          {l.loginId ? (
            <button type="button" onClick={copyId} title="Copy user ID" aria-label={`Copy user ID ${l.loginId}`} className="inline-flex min-w-0 items-center gap-1 rounded font-mono text-ink hover:text-brand-700 active:scale-95">
              <span className="truncate">{l.loginId}</span>
              {copied === "id" ? <Check size={13} className="shrink-0 text-low-ink" /> : <Copy size={13} className="shrink-0 text-slate-400" />}
            </button>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-slate-500">Password</span>
          {l.hasPassword ? (
            <>
              <span className={cx("font-mono", shown === null ? "tracking-widest text-slate-500" : "text-ink select-all")}>{shown ?? "••••••••"}</span>
              <button type="button" onClick={show} disabled={busy} aria-label={shown === null ? "Show password" : "Hide password"} title={shown === null ? "Show" : "Hide"} className="rounded p-0.5 text-slate-500 hover:text-ink active:scale-90 disabled:opacity-50">
                {shown === null ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <button type="button" onClick={copyPassword} aria-label="Copy password" title="Copy password" className="ml-1.5 rounded p-0.5 pointer-coarse:ml-3 text-slate-500 hover:text-ink active:scale-90">
                {copied === "password" ? <Check size={15} className="text-low-ink" /> : <Copy size={15} />}
              </button>
            </>
          ) : (
            <span className="text-slate-400">Not saved</span>
          )}
        </span>
      </div>
      {l.remarks && <p className="mt-1 line-clamp-2 text-footnote text-slate-500">{l.remarks}</p>}
      {note && shown !== null && <p className="mt-1 text-footnote text-high-ink">{note}</p>}
      {error != null && (
        <div className="mt-1">
          <ErrorNote error={error} />
        </div>
      )}
    </li>
  );
}

// --- Add / edit form ---

export function LoginDialog({ state, onClose }: { state: LoginFormState; onClose: () => void }) {
  return (
    <Modal open={state !== null} onClose={onClose} title={state?.login ? "Edit login" : "Add login"}>
      {state && <LoginForm key={state.login?.id ?? "new"} login={state.login} preset={state.preset} onDone={onClose} />}
    </Modal>
  );
}

function LoginForm({ login, preset, onDone }: { login: SiteLogin | null; preset?: Partial<SiteLoginInput>; onDone: () => void }) {
  // The employee list is kept for a day; ask again when the form opens so someone added elsewhere is offered.
  const qc = useQueryClient();
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["staff"] });
  }, [qc]);
  const staff = useStaff().data;
  const all = useLogins().data?.logins ?? [];
  const websites = [...new Set(all.map((l) => l.website))].sort();
  const roles = [...new Set([...ROLES, ...all.filter((l) => !l.employeeId && l.assignedTo).map((l) => l.assignedTo)])];
  const employees = [...(staff?.employees ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const [website, setWebsite] = useState(login?.website ?? preset?.website ?? "");
  const [url, setUrl] = useState(login?.url ?? preset?.url ?? "");
  const [kind, setKind] = useState<"employee" | "role">(login ? (login.employeeId ? "employee" : "role") : preset?.employeeId ? "employee" : "role");
  const [employeeId, setEmployeeId] = useState(login?.employeeId ?? preset?.employeeId ?? "");
  const [assignedTo, setAssignedTo] = useState(login && !login.employeeId ? login.assignedTo : "");
  const [loginId, setLoginId] = useState(login?.loginId ?? "");
  const [password, setPassword] = useState("");
  const [seePassword, setSeePassword] = useState(false);
  const [removePassword, setRemovePassword] = useState(false);
  const [remarks, setRemarks] = useState(login?.remarks ?? "");
  const { add, save, remove } = useLoginActions();
  const busy = add.isPending || save.isPending || remove.isPending;

  // Picking a website already saved fills in its link.
  const pickWebsite = (v: string) => {
    setWebsite(v);
    const known = all.find((l) => l.website.toLowerCase() === v.trim().toLowerCase() && l.url);
    if (known && !url) setUrl(known.url);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input: SiteLoginInput = {
      website,
      url,
      employeeId: kind === "employee" && employeeId ? employeeId : null,
      assignedTo: kind === "role" ? assignedTo : "",
      loginId,
      remarks,
      // Empty = keep the saved one (unless Remove was ticked).
      ...(password ? { password } : removePassword ? { password: "" } : {}),
    };
    try {
      if (login) await save.mutateAsync({ id: login.id, input });
      else await add.mutateAsync(input);
      onDone();
    } catch {
      // shown under the form
    }
  };
  const del = () => {
    if (!login || !confirm(`Remove this ${login.website} login${login.loginId ? ` (${login.loginId})` : ""}?`)) return;
    remove.mutate(login.id, { onSuccess: onDone });
  };

  return (
    // autoComplete off: these are other websites' logins, not WorkDesk's, so the browser shouldn't offer to save them.
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Website name">
          <input className={inputClass} value={website} onChange={(e) => pickWebsite(e.target.value)} list="login-websites" required autoFocus={!login && !preset?.website} maxLength={100} placeholder="e.g. SPARK, BiMS" />
          <datalist id="login-websites">
            {websites.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </Field>
        <Field label="Link (optional)">
          <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" maxLength={500} placeholder="e.g. https://www.spark.gov.in" />
        </Field>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Assigned to</span>
        <div role="radiogroup" aria-label="Assigned to" className="mb-2 inline-flex gap-1.5">
          {([
            ["employee", "An employee", UserRound],
            ["role", "A role or name", UsersRound],
          ] as const).map(([value, text, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800"
            >
              <Icon size={15} /> {text}
            </button>
          ))}
        </div>
        {kind === "employee" ? (
          <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Employee" required>
            <option value="">Choose an employee…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.leftOn ? " (left)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input className={inputClass} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} list="login-roles" maxLength={100} placeholder="e.g. DDO, Section clerk" aria-label="Role or name" />
            <datalist id="login-roles">
              {roles.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="User ID">
          <input className={inputClass} value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={200} />
        </Field>
        <Field label="Password">
          <div className="relative">
            <input
              className={cx(inputClass, "pr-10")}
              type={seePassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (e.target.value) setRemovePassword(false);
              }}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={500}
              placeholder={login?.hasPassword ? "Saved · type to replace" : ""}
            />
            <button type="button" onClick={() => setSeePassword((v) => !v)} aria-label={seePassword ? "Hide typed password" : "Show typed password"} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-ink active:scale-90">
              {seePassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {login?.hasPassword && !password && (
            <label className="mt-1.5 flex items-center gap-2 text-footnote text-slate-600">
              <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} className="size-4 accent-brand-600" />
              Remove the saved password
            </label>
          )}
        </Field>
      </div>

      <Field label="Remarks (optional)">
        <textarea className={cx(inputClass, "h-auto py-2")} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={2000} placeholder="e.g. password changes every 90 days, registered mobile" />
      </Field>
      <p className="text-footnote text-slate-500">Passwords are stored encrypted and only shown when you tap Show or Copy. Each time is noted in History.</p>
      <ErrorNote error={add.error ?? save.error ?? remove.error} />
      <div className="flex flex-wrap items-center gap-2">
        {login && (
          <Button type="button" variant="danger" onClick={del} disabled={busy} aria-label="Remove login" title="Remove login">
            <Trash2 size={15} />
          </Button>
        )}
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          <Check size={16} /> {login ? "Save" : "Add login"}
        </Button>
      </div>
    </form>
  );
}
