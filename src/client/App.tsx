import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import {
  Bell,
  CalendarDays,
  CalendarCheck,
  ChevronDown,
  FileText,
  History as HistoryIcon,
  House,
  ListChecks,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { ApiError, logout, useMe, useSummary, useSync } from "./api";
import { formatWhen } from "./format";
import { Avatar } from "./components/Avatar";
import { TONE, cx, type Tone } from "./components/ui";
import { HomePage } from "./pages/Home";
import { InboxPage } from "./pages/Inbox";
import { TasksPage } from "./pages/Tasks";
import { CalendarPage } from "./pages/Calendar";
import { SearchPage } from "./pages/Search";
import { HistoryPage } from "./pages/History";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";

export function App() {
  const me = useMe();
  if (me.isPending) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
  if (me.error) return <div className="p-8 text-sm text-urgent-ink">Could not reach WorkDesk: {me.error.message}</div>;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/inbox" element={<Page><InboxPage /></Page>} />
        <Route path="/tasks" element={<Page><TasksPage /></Page>} />
        <Route path="/calendar" element={<Page wide><CalendarPage /></Page>} />
        <Route path="/reports" element={<Page><ReportsPage /></Page>} />
        <Route path="/history" element={<Page><HistoryPage /></Page>} />
        <Route path="/search" element={<Page><SearchPage /></Page>} />
        <Route path="/settings" element={<Page><SettingsPage /></Page>} />
        <Route path="*" element={<Page><p className="text-slate-500">Page not found.</p></Page>} />
      </Routes>
    </Shell>
  );
}

function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx("mx-auto w-full px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:px-8", wide ? "max-w-7xl" : "max-w-5xl")}>{children}</div>;
}

type NavItem = { to: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/inbox", label: "Emails", icon: Mail },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/history", label: "History", icon: HistoryIcon },
];

function Shell({ children }: { children: ReactNode }) {
  const counts = useSummary().data?.counts;
  const badge: Record<string, number | undefined> = { "/inbox": counts?.pendingEmails };

  return (
    <div className="min-h-dvh bg-canvas-soft md:flex">
      <FirstSync />
      {/* Labelled icon rail */}
      <aside className="sticky top-0 hidden h-dvh w-[104px] shrink-0 flex-col border-r border-line bg-white md:flex">
        <Link to="/" className="flex h-20 items-center justify-center border-b border-line" title="WorkDesk">
          <span className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <CalendarCheck size={22} />
          </span>
        </Link>
        <nav className="flex flex-1 flex-col py-3">
          {NAV.map((n) => (
            <RailLink key={n.to} item={n} count={badge[n.to]} />
          ))}
        </nav>
        <div className="border-t border-line py-3">
          <RailLink item={{ to: "/settings", label: "Settings", icon: SettingsIcon }} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              cx("relative flex flex-col items-center gap-0.5 py-2 text-[10px]", isActive ? "font-medium text-brand-700" : "text-slate-500")
            }
          >
            <n.icon size={20} strokeWidth={1.7} />
            {n.label}
            {!!badge[n.to] && <CountDot n={badge[n.to]!} className="top-1 left-1/2 ml-1.5" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function RailLink({ item, count }: { item: NavItem; count?: number }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cx(
          "relative flex flex-col items-center gap-1 border-l-[3px] py-3.5 text-[13px] transition-colors",
          isActive ? "border-brand-600 bg-tint font-medium text-brand-700" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-ink",
        )
      }
    >
      <span className="relative">
        <item.icon size={24} strokeWidth={1.6} />
        {!!count && <CountDot n={count} className="-top-1.5 -right-3" />}
      </span>
      {item.label}
    </NavLink>
  );
}

function CountDot({ n, className, urgent }: { n: number; className?: string; urgent?: boolean }) {
  return (
    <span
      className={cx(
        "absolute min-w-[18px] rounded-full px-1 text-center text-[10px] leading-[18px] font-medium text-white tabular-nums",
        urgent ? "bg-urgent" : "bg-brand-600",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

// --- Top bar ---

function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  // Clear the box when leaving the search page.
  useEffect(() => {
    if (location.pathname !== "/search") setQ("");
  }, [location.pathname]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-4 md:h-20 md:gap-6 md:px-6 lg:px-8">
        <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white md:hidden">
            <CalendarCheck size={18} />
          </span>
          <span>
            <span className="block text-lg leading-tight font-semibold text-ink md:text-2xl">
              WorkDesk
              <span className="ml-1.5 align-baseline text-[11px] font-normal text-slate-400 md:text-xs" title="Version">
                v{__APP_VERSION__}
              </span>
            </span>
            <span className="hidden text-[13px] text-slate-500 lg:block">Every email accounted for. Every task tracked.</span>
          </span>
        </Link>

        <form onSubmit={submit} className="relative mx-auto hidden w-full max-w-xl sm:block">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search emails, tasks, reports…"
            aria-label="Search"
            className="h-11 w-full rounded-xl border border-line bg-canvas-soft pr-3 pl-10 text-sm placeholder:text-slate-400 focus:border-brand-200 focus:bg-white"
          />
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 pointer-coarse:gap-2">
          <Link to="/search" className="rounded-lg p-2 text-slate-600 sm:hidden pointer-coarse:p-2" aria-label="Search">
            <Search size={20} />
          </Link>
          <SyncButton />
          <Notifications />
          <UserMenu />
        </div>
      </div>
    </header>
  );
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
      className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-60 pointer-coarse:p-2"
    >
      <span className="relative inline-flex">
        <Mail size={21} strokeWidth={1.8} className={cx(sync.isPending && "text-brand-600")} />
        <span className="absolute -right-1.5 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-white">
          <RefreshCw size={10} strokeWidth={2.8} className={cx(sync.isPending ? "animate-spin text-brand-600" : "text-slate-600")} />
        </span>
      </span>
      {a?.lastSyncError && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-urgent" />}
    </button>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function Notifications() {
  const summary = useSummary().data;
  const me = useMe().data;
  const { open, setOpen, ref } = usePopover();
  const navigate = useNavigate();

  const items: { key: string; tone: Tone; title: string; detail: string; to: string }[] = [];
  if (me?.account?.lastSyncError) items.push({ key: "sync", tone: "urgent", title: "Gmail sync failed", detail: me.account.lastSyncError.slice(0, 90), to: "/settings" });
  for (const t of summary?.overdue ?? []) items.push({ key: `o${t.id}`, tone: "urgent", title: "Overdue", detail: t.title, to: "/tasks?view=overdue" });
  for (const t of summary?.newActivity ?? []) items.push({ key: `n${t.id}`, tone: "brand", title: "New reply on a task", detail: t.title, to: "/tasks" });
  for (const t of summary?.dueToday ?? []) items.push({ key: `d${t.id}`, tone: "high", title: "Due today", detail: t.title, to: "/tasks?view=today" });
  const alertCount = items.filter((i) => i.tone !== "high").length;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 pointer-coarse:p-2" aria-label={`Notifications (${alertCount})`} aria-expanded={open}>
        <Bell size={21} strokeWidth={1.8} />
        {alertCount > 0 && <CountDot n={alertCount} urgent className="-top-0.5 -right-0.5" />}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white shadow-xl">
          <div className="border-b border-line px-4 py-3 text-sm font-medium text-ink">Notifications</div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</p>
          ) : (
            <ul className="scroll-thin max-h-96 overflow-y-auto py-1">
              {items.map((i) => (
                <li key={i.key}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      navigate(i.to);
                    }}
                    className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", TONE[i.tone].dot)} />
                    <span className="min-w-0">
                      <span className="block text-xs text-slate-500">{i.title}</span>
                      <span className="block truncate text-sm text-ink">{i.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const me = useMe().data;
  const { open, setOpen, ref } = usePopover();
  const name = me?.name ?? me?.email ?? "";
  return (
    <div className="relative ml-1" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl py-1 pr-1 pl-1 hover:bg-slate-100 md:pr-2" aria-expanded={open} aria-label="Account menu">
        <Avatar name={name} src={me?.picture} size={40} />
        <span className="hidden max-w-36 truncate text-sm font-medium text-ink md:block">{name}</span>
        <ChevronDown size={16} className="hidden text-slate-500 md:block" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-line bg-white p-1 shadow-xl">
          <div className="px-3 py-2.5">
            <div className="truncate text-sm font-medium text-ink">{name}</div>
            <div className="truncate text-xs text-slate-500">{me?.demo ? "Demo mode · sample emails" : (me?.account?.email ?? me?.email)}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <SettingsIcon size={16} /> Settings
          </Link>
          {!me?.demo && (
            <button
              onClick={() => logout().then(() => location.assign("/"))}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 pointer-coarse:py-2.5"
            >
              <LogOut size={16} /> Sign out
            </button>
          )}
        </div>
      )}
    </div>
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
