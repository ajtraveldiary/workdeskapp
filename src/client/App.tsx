import { useEffect, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router";
import { CalendarCheck, History as HistoryIcon, Inbox as InboxIcon, ListChecks, LogOut, RefreshCw, Settings as SettingsIcon, Sun } from "lucide-react";
import { ApiError, logout, useMe, useSummary, useSync } from "./api";
import { formatWhen } from "./format";
import { cx } from "./components/ui";
import { TodayPage } from "./pages/Today";
import { InboxPage } from "./pages/Inbox";
import { TasksPage } from "./pages/Tasks";
import { HistoryPage } from "./pages/History";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";

export function App() {
  const me = useMe();
  if (me.isPending) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
  if (me.error) return <div className="p-8 text-sm text-red-700">Could not reach WorkDesk: {me.error.message}</div>;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<p className="text-slate-500">Page not found.</p>} />
      </Routes>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const summary = useSummary().data;
  const nav = [
    { to: "/", label: "Today", icon: Sun, count: summary ? summary.counts.overdue + summary.counts.dueToday : 0, urgent: !!summary?.counts.overdue },
    { to: "/inbox", label: "Inbox", icon: InboxIcon, count: summary?.counts.pendingEmails ?? 0 },
    { to: "/tasks", label: "Tasks", icon: ListChecks },
    { to: "/reports", label: "Reports", icon: CalendarCheck },
    { to: "/history", label: "History", icon: HistoryIcon },
  ];

  return (
    <div className="min-h-dvh md:flex">
      <FirstSync />
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand-700 text-white">
              <CalendarCheck size={16} />
            </span>
            <span className="text-lg font-semibold tracking-tight">WorkDesk</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Every email accounted for.</p>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                  isActive ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )
              }
            >
              <n.icon size={18} />
              {n.label}
              {!!n.count && (
                <span
                  className={cx(
                    "ml-auto rounded-full px-2 text-xs tabular-nums",
                    n.urgent ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {n.count}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-slate-200 p-3">
          <SyncStatus />
          <div className="flex gap-1">
            <NavLink to="/settings" className="flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              <SettingsIcon size={16} /> Settings
            </NavLink>
            <SignOut />
          </div>
        </div>
      </aside>

      {/* Mobile header + bottom navigation */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:hidden">
        <span className="font-semibold">WorkDesk</span>
        <div className="flex items-center gap-1">
          <SyncButton compact />
          <NavLink to="/settings" className="rounded p-2 text-slate-600" aria-label="Settings">
            <SettingsIcon size={18} />
          </NavLink>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-10">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              cx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-brand-700" : "text-slate-500")
            }
          >
            <n.icon size={20} />
            {n.label}
            {!!n.count && (
              <span className={cx("absolute top-1 left-1/2 ml-2 rounded-full px-1.5 text-[10px] text-white", n.urgent ? "bg-red-600" : "bg-slate-500")}>
                {n.count}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SyncButton({ compact }: { compact?: boolean }) {
  const me = useMe().data;
  const sync = useSync();
  return (
    <button
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      title="Check Gmail for new email"
      className={cx(
        "inline-flex items-center gap-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60",
        compact ? "p-2" : "w-full px-3 py-2",
      )}
    >
      <RefreshCw size={16} className={cx(sync.isPending && "animate-spin")} />
      {!compact && (sync.isPending ? "Syncing…" : me?.demo ? "Simulate new email" : "Sync now")}
    </button>
  );
}

// First sign-in: pull the inbox right away. Rendered once, in the shell.
function FirstSync() {
  const me = useMe().data;
  const sync = useSync();
  const neverSynced = !!me?.account && !me.account.lastSyncAt;
  useEffect(() => {
    if (neverSynced && sync.isIdle) sync.mutate();
  }, [neverSynced, sync]);
  return null;
}

function SyncStatus() {
  const me = useMe().data;
  const a = me?.account;
  return (
    <div>
      <SyncButton />
      <p className="px-3 text-xs text-slate-500">
        {me?.demo
          ? "Demo mode: sample emails"
          : a?.lastSyncError
            ? <span className="text-red-600">Sync problem: {a.lastSyncError.slice(0, 80)}</span>
            : a?.lastSyncAt
              ? `${a.email} · synced ${formatWhen(a.lastSyncAt)}`
              : "Not synced yet"}
      </p>
    </div>
  );
}

function SignOut() {
  const demo = useMe().data?.demo;
  if (demo) return null;
  return (
    <button
      onClick={() => logout().then(() => location.assign("/"))}
      className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
      title="Sign out"
      aria-label="Sign out"
    >
      <LogOut size={16} />
    </button>
  );
}
