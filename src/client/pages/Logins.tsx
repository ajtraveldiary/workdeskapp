// Logins page (user request 2026-10-11): saved logins for office websites, grouped by website. SPARK-style sites
// have a login per employee, BiMS-style sites shared logins for a role (DDO, Section clerk). Passwords stay hidden
// until Show or Copy (components/Logins.tsx). In the side rail after Files; in the phone profile panel.
import { useState } from "react";
import { KeyRound, Plus, Search } from "lucide-react";
import { useLogins } from "../api";
import { LoginDialog, LoginGroups, type LoginFormState } from "../components/Logins";
import { RefreshButton } from "../components/RefreshButton";
import { Button, Card, Fab, PageHeader, SkeletonList, cx, inputClass } from "../components/ui";

export function LoginsPage() {
  const { data, error } = useLogins();
  const [q, setQ] = useState("");
  const [form, setForm] = useState<LoginFormState>(null);
  const logins = data?.logins ?? [];
  const query = q.trim().toLowerCase();
  const shown = logins.filter((l) => !query || [l.website, l.assignedTo, l.loginId, l.remarks, l.url].some((x) => x.toLowerCase().includes(query)));
  const add = () => setForm({ login: null });

  return (
    <>
      <PageHeader
        title="Logins"
        subtitle="Website logins for the office: one per employee (like SPARK) or shared by a role (like BiMS). Passwords stay hidden until you tap Show or Copy."
        actions={
          <>
            <RefreshButton keys={[["logins"]]} label="Refresh logins" />
            <Button variant="primary" onClick={add} className="max-sm:hidden">
              <Plus size={17} /> Add login
            </Button>
          </>
        }
      />
      <Fab label="Add login" onClick={add} />
      {error ? (
        <p className="text-urgent-ink">{error.message}</p>
      ) : !data ? (
        <SkeletonList rows={6} />
      ) : logins.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-info text-white">
            <KeyRound size={22} />
          </span>
          <p className="mt-3 font-medium text-ink">No logins saved yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Save the office's website logins here: each employee's SPARK login, the DDO and section clerk logins for BiMS, and so on.
          </p>
          <Button variant="primary" className="mt-4" onClick={add}>
            <Plus size={16} /> Add login
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search website, person, role or user ID" aria-label="Search logins" className={cx(inputClass, "pl-9")} />
          </label>
          {shown.length === 0 ? (
            <Card>
              <p className="px-5 py-8 text-center text-sm text-slate-500">No login matches “{q.trim()}”.</p>
            </Card>
          ) : (
            <LoginGroups logins={shown} onEdit={(login) => setForm({ login })} onAdd={(preset) => setForm({ login: null, preset })} />
          )}
        </div>
      )}
      <LoginDialog state={form} onClose={() => setForm(null)} />
    </>
  );
}
