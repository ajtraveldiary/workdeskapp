import { useEffect, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router";
import {
  CalendarCheck,
  History as HistoryIcon,
  House,
  Inbox as InboxIcon,
  ListChecks,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
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
        <Route path="/inbox" element={<Padded><InboxPage /></Padded>} />
        <Route path="/tasks" element={<Padded><TasksPage /></Padded>} />
        <Route path="/reports" element={<Padded><ReportsPage /></Padded>} />
        <Route path="/history" element={<Padded><HistoryPage /></Padded>} />
        <Route path="/settings" element={<Padded><SettingsPage /></Padded>} />
        <Route path="*" element={<Padded><p className="text-slate-500">Page not found.</p></Padded>} />
      </Routes>
    </Shell>
  );
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-10">{children}</div>;
}

type NavItem = { to: string; label: string; icon: LucideIcon; count?: number; urgent?: boolean };

function Shell({ children }: { children: ReactNode }) {
  const summary = useSummary().data;
  const nav: NavItem[] = [
    { to: "/", label: "Home", icon: House, count: summary?.counts.overdue, urgent: true },
    { to: "/inbox", label: "Inbox", icon: InboxIcon, count: summary?.counts.pendingEmails },
    { to: "/tasks", label: "Tasks", icon: ListChecks },
    { to: "/reports", label: "Reports", icon: CalendarCheck },
    { to: "/history", label: "History", icon: HistoryIcon },
  ];

  return (
    <div className="min-h-dvh lg:p-5">
      <FirstSync />
      <div className="flex min-h-dvh bg-white lg:min-h-[calc(100dvh-2.5rem)] lg:overflow-hidden lg:rounded-2xl lg:shadow-[0_10px_40px_-12px_rgb(31_33_48/0.18)]">
        {/* Icon rail */}
        <aside className="sticky top-0 hidden h-dvh w-[84px] shrink-0 flex-col items-center border-r border-line py-6 md:flex lg:h-[calc(100dvh-2.5rem)]">
          <span className="mb-8 flex size-10 items-center justify-center rounded-xl bg-brand-600 text-white" title="WorkDesk">
            <CalendarCheck size={20} />
          </span>
          <nav className="flex flex-1 flex-col items-center gap-2">
            {nav.map((n) => (
              <RailLink key={n.to} item={n} />
            ))}
          </nav>
          <div className="flex flex-col items-center gap-2">
            <SyncButton />
            <SignOut />
            <span className="my-1 h-px w-10 bg-line" />
            <RailLink item={{ to: "/settings", label: "Settings", icon: SettingsIcon }} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile header */}
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur md:hidden">
            <span className="flex items-center gap-2 font-medium">
              <span className="flex size-7 items-center justify-center rounded-lg bg-brand-600 text-white">
                <CalendarCheck size={15} />
              </span>
              WorkDesk
            </span>
            <div className="flex items-center gap-1">
              <SyncButton />
              <NavLink to="/settings" className="rounded-lg p-2 text-slate-500" aria-label="Settings">
                <SettingsIcon size={19} />
              </NavLink>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              cx("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive ? "font-medium text-brand-700" : "text-slate-400")
            }
          >
            <n.icon size={20} strokeWidth={1.7} />
            {n.label}
            {!!n.count && <CountDot n={n.count} urgent={n.urgent} className="top-1 left-1/2 ml-2" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function RailLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      title={item.label}
      aria-label={item.label}
      className={({ isActive }) =>
        cx(
          "relative flex size-11 items-center justify-center rounded-xl transition-colors",
          isActive ? "bg-mint text-brand-700" : "text-slate-400 hover:bg-slate-50 hover:text-slate-700",
        )
      }
    >
      <item.icon size={21} strokeWidth={1.6} />
      {!!item.count && <CountDot n={item.count} urgent={item.urgent} className="-top-0.5 -right-0.5" />}
    </NavLink>
  );
}

function CountDot({ n, urgent, className }: { n: number; urgent?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "absolute min-w-[18px] rounded-full px-1 text-center text-[10px] leading-[18px] font-medium text-white tabular-nums",
        urgent ? "bg-red-500" : "bg-brand-600",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
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

function SyncButton() {
  const me = useMe().data;
  const sync = useSync();
  const a = me?.account;
  const status = me?.demo
    ? "Demo mode: simulate a new email"
    : a?.lastSyncError
      ? `Sync problem: ${a.lastSyncError}`
      : a?.lastSyncAt
        ? `Sync Gmail (last synced ${formatWhen(a.lastSyncAt)})`
        : "Sync Gmail";
  return (
    <button
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      title={status}
      aria-label={status}
      className="relative flex size-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-60"
    >
      <RefreshCw size={19} strokeWidth={1.7} className={cx(sync.isPending && "animate-spin text-brand-600")} />
      {a?.lastSyncError && <span className="absolute top-2 right-2 size-2 rounded-full bg-red-500" />}
    </button>
  );
}

function SignOut() {
  const demo = useMe().data?.demo;
  if (demo) return null;
  return (
    <button
      onClick={() => logout().then(() => location.assign("/"))}
      className="flex size-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-700"
      title="Sign out"
      aria-label="Sign out"
    >
      <LogOut size={19} strokeWidth={1.7} />
    </button>
  );
}
