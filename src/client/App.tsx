import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import {
  Bell,
  BellRing,
  CalendarDays,
  Check,
  TriangleAlert,
  WifiOff,
  CalendarCheck,
  Presentation,
  TreePalm,
  ClipboardCheck,
  NotebookPen,
  LayoutDashboard,
  Inbox,
  SquareCheckBig,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  UsersRound,
  FolderOpen,
  KeyRound,
  X,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { ApiError, logout, useMe, useSummary, useSync, useAssistantUnseen } from "./api";
import { useConnection, warmOfflineCopy } from "./connection";
import { isDbIssue } from "./dbStatus";
import { DatabaseIssueDialog, DatabaseIssuePage } from "./components/DatabaseIssue";
import { formatWhen } from "./format";
import { Avatar } from "./components/Avatar";
import { UndoBar, showUndo } from "./components/SwipeRow";
import { WaitDialogHost } from "./components/Waiting";
import { RemoveChooserHost } from "./components/RemoveChooser";
import { SystemTaskChooserHost } from "./components/SystemTaskChooser";
import { IncrementDialogHost } from "./components/IncrementDialog";
import { SidePanel } from "./components/SidePanel";
import { PageErrorBoundary } from "./components/ErrorBoundary";
import { usePhone } from "./components/sheet";
import { refreshPushSubscription, setIconBadge } from "./push";
import { PopPanel, Spinner, Splash, TONE, cx, type Tone } from "./components/ui";
import { HomePage } from "./pages/Home";
import { InboxPage } from "./pages/Inbox";
import { TasksPage } from "./pages/Tasks";
import { CalendarPage } from "./pages/Calendar";
import { SearchPage } from "./pages/Search";
import { StaffPage } from "./pages/Staff";
import { EmployeePage } from "./pages/EmployeePage";
import { FilesPage } from "./pages/Files";
import { LoginsPage } from "./pages/Logins";
import { EventsPage } from "./pages/Events";
import { EventDialogHost } from "./components/EventDialog";
import { EventDetailsHost } from "./components/EventDetails";
import { RemindersPage } from "./pages/Reminders";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";
import { RegistersPage } from "./pages/Registers";
import { LeavePage } from "./pages/Leave";
import { AttendancePage } from "./pages/Attendance";

export function App() {
  const me = useMe();
  // Opened offline before WorkDesk was ever loaded on this device: nothing saved to show yet.
  if (me.isPending) return me.fetchStatus === "paused" ? <OfflineStart /> : <Splash />;
  if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
  // Database paused (Neon usage limit) or down: say so, with the way to check it (user request 2026-10-06).
  if (isDbIssue(me.error)) return <DatabaseIssuePage issue={me.error} onRetry={() => void me.refetch()} />;
  // Offline with a saved copy: the app opens with it (user request 2026-10-07, offline viewing).
  if (me.error && !me.data) {
    if (!(me.error instanceof ApiError)) return <OfflineStart onRetry={() => void me.refetch()} />;
    return <div className="p-8 text-sm text-urgent-ink">Could not reach WorkDesk: {me.error.message}</div>;
  }

  return (
    <Shell>
      <DatabaseIssueDialog />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/inbox" element={<Page full><InboxPage /></Page>} />
        <Route path="/tasks" element={<Page><TasksPage /></Page>} />
        <Route path="/calendar" element={<Page full><CalendarPage /></Page>} />
        <Route path="/reminders" element={<Page><RemindersPage /></Page>} />
        <Route path="/reports" element={<Navigate to="/reminders" replace />} />
        {/* History and Import / Export are Settings tabs now (user request 2026-10-15); old links still work. */}
        <Route path="/history" element={<Navigate to="/settings#history" replace />} />
        <Route path="/search" element={<Page><SearchPage /></Page>} />
        <Route path="/settings" element={<Page><SettingsPage /></Page>} />
        <Route path="/employees" element={<Page><StaffPage /></Page>} />
        {/* An employee's own page (user request 2026-10-08), opened from the Employees list or table. */}
        <Route path="/employees/:id" element={<Page wide><EmployeePage /></Page>} />
        <Route path="/import-export" element={<Navigate to="/settings#import-export" replace />} />
        {/* Was /staff before the page was renamed Employees (user request 2026-10-07). */}
        <Route path="/staff" element={<StaffRedirect />} />
        {/* Leave (user request 2026-10-31): moved from the employee's page to its own page. */}
        <Route path="/leave" element={<Page><LeavePage /></Page>} />
        {/* Attendance register (user request 2026-10-31): the whole width, like a register page. */}
        <Route path="/attendance" element={<Page full><AttendancePage /></Page>} />
        <Route path="/files" element={<Page><FilesPage /></Page>} />
        {/* Registers (user request 2026-10-16): two halves side by side on wide screens. */}
        <Route path="/registers" element={<Page wide><RegistersPage /></Page>} />
        <Route path="/logins" element={<Page><LoginsPage /></Page>} />
        <Route path="/events" element={<Page><EventsPage /></Page>} />
        <Route path="*" element={<Page><p className="text-slate-500">Page not found.</p></Page>} />
      </Routes>
    </Shell>
  );
}

function Page({ children, wide, full }: { children: ReactNode; wide?: boolean; full?: boolean }) {
  // Left-aligned like Home, so page titles line up with the top bar on every screen (alignment pass 2026-10-06).
  // full: the whole width of big screens (Calendar, user request 2026-10-12: "huge blank space").
  return <div className={cx("w-full px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:px-8", full ? "max-w-none" : wide ? "max-w-7xl" : "max-w-5xl")}>{children}</div>;
}

// group: where it sits in the computer sidebar (user request 2026-10-31): My work or Office.
type NavItem = { to: string; label: string; icon: LucideIcon; group?: "work" | "office" };

// Old /staff links (Home's increment rows before the rename) keep their ?employee=… part.
function StaffRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/employees${search}`} replace />;
}

// Clearer icons (user request 2026-10-31: four of them were calendars), the same in the sidebar, the phone tab bar,
// the profile panel and the account menu.
const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, group: "work" },
  { to: "/inbox", label: "Emails", icon: Inbox, group: "work" },
  { to: "/tasks", label: "Tasks", icon: SquareCheckBig, group: "work" },
  { to: "/reminders", label: "Reminders", icon: BellRing, group: "work" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, group: "work" },
  // Events: meetings, trainings, programmes (user request 2026-10-11): rail on wider screens, profile menu on phones.
  { to: "/events", label: "Events", icon: Presentation, group: "work" },
  // Employees page (formerly Staff, user request 2026-10-07): in the side rail on wider screens, in the profile menu on phones.
  { to: "/employees", label: "Employees", icon: UsersRound, group: "office" },
  // Leave (user request 2026-10-31), after Employees: rail on wider screens, profile menu on phones.
  { to: "/leave", label: "Leave", icon: TreePalm, group: "office" },
  // Attendance register (user request 2026-10-31), after Leave.
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck, group: "office" },
  // File register (user request 2026-10-07), next to Staff: rail on wider screens, profile menu on phones.
  { to: "/files", label: "File register", icon: FolderOpen, group: "office" },
  // Registers (user request 2026-10-16), after Files: rail on wider screens, profile menu on phones.
  { to: "/registers", label: "Registers", icon: NotebookPen, group: "office" },
  // Saved website logins (user request 2026-10-11), after Files: rail on wider screens, profile menu on phones.
  { to: "/logins", label: "Website logins", icon: KeyRound, group: "office" },
];

function Shell({ children }: { children: ReactNode }) {
  const counts = useSummary().data?.counts;
  const badge: Record<string, number | undefined> = { "/inbox": counts?.pendingEmails };
  // Phones scroll only the page area (below), so each screen starts at its top, as in apps.
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);
  // Save a copy of the main screens for offline use, a little after start-up (connection.ts).
  useEffect(() => {
    const t = setTimeout(warmOfflineCopy, 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    // Phones (under 768px), and WorkDesk opened from the home screen on any device, are laid out like an app
    // (2026-10-06: "doesn't behave like a mobile app, elements not fixed in position"; "every UI element should
    // act like a mobile app"): the screen itself never scrolls, bounces or slides sideways; the top bar and the
    // tab bar stay put and only the page area between them scrolls. See .app-shell in styles.css. Computers in
    // a browser scroll the page as before.
    <div className="app-shell bg-canvas-soft md:flex">
      <FirstSync />
      <UndoBar />
      <WaitDialogHost />
      <RemoveChooserHost />
      <SystemTaskChooserHost />
      <IncrementDialogHost />
      <EventDialogHost />
      <EventDetailsHost />
      <IconBadge />
      <Sidebar badge={badge} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <main ref={mainRef} className="app-main relative min-h-0 flex-1 pb-[calc(var(--tabbar-h)+1rem+env(safe-area-inset-bottom))] md:pb-0">
          <PullToRefresh scroller={mainRef} />
          {/* Each new page slides up and fades in (user request 2026-10-07; .page-in in styles.css). */}
          <div key={pathname} className="page-in">
            <PageErrorBoundary>{children}</PageErrorBoundary>
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation (History lives in Settings on phones, user request 2026-10-06): standard app tab bar (user request 2026-10-06), clear of the iPhone's rounded
          corners and home bar via the safe-area insets (needs viewport-fit=cover in index.html). */}
      <nav className="tabbar fixed inset-x-0 bottom-0 z-20 grid h-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-white/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden">
        {NAV.filter((n) => n.to !== "/history" && n.to !== "/employees" && n.to !== "/leave" && n.to !== "/attendance" && n.to !== "/import-export" && n.to !== "/files" && n.to !== "/registers" && n.to !== "/logins" && n.to !== "/events").map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              cx("relative flex flex-col items-center justify-center gap-1 text-footnote leading-none active:scale-95", isActive ? "font-medium text-brand-700" : "text-slate-500 hover:text-ink")
            }
          >
            <n.icon size={26} strokeWidth={1.8} />
            {n.label}
            {!!badge[n.to] && <CountDot n={badge[n.to]!} className="top-1 left-1/2 ml-2" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// Pull the page down from the top to refresh, like apps (user request 2026-10-06): fetches new Gmail and
// reloads what's on screen (the same as the top bar's sync button). Touch screens in app layout only.
function PullToRefresh({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const sync = useSync();
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const TRIGGER = 70;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let state: "idle" | "maybe" | "drag" = "idle";
    let startX = 0;
    let startY = 0;
    let dist = 0;
    const appLayout = () => getComputedStyle(el).overflowY === "auto" && window.matchMedia("(pointer: coarse)").matches;
    const start = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || el.scrollTop > 0 || !appLayout()) return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      dist = 0;
      state = "maybe";
    };
    const move = (e: TouchEvent) => {
      if (state === "idle") return;
      const x = e.touches[0]!.clientX - startX;
      const y = e.touches[0]!.clientY - startY;
      if (state === "maybe") {
        // Sideways swipes (list rows, calendar months) and upward scrolls are left alone.
        if ((Math.abs(x) > 8 && Math.abs(x) > Math.abs(y)) || y < -4 || el.scrollTop > 0) return void (state = "idle");
        if (y < 8) return;
        state = "drag";
      }
      e.preventDefault();
      dist = Math.min(120, Math.max(0, y - 8) * 0.5);
      setPull(dist);
    };
    const end = () => {
      if (state !== "drag") return void (state = "idle");
      state = "idle";
      setPull(0);
      if (dist < TRIGGER * 0.75) return;
      busyRef.current = true;
      setBusy(true);
      syncRef.current.mutate(undefined, {
        onSettled: () => {
          busyRef.current = false;
          setBusy(false);
        },
      });
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [scroller]);

  if (!pull && !busy) return null;
  const ready = pull >= TRIGGER * 0.75;
  return (
    <div className="pointer-events-none sticky top-0 z-30 h-0" aria-live="polite">
      <div
        className="mx-auto flex size-9 items-center justify-center rounded-full border border-line bg-white text-brand-600 shadow-md"
        style={{ transform: `translateY(${busy ? 12 : pull - 28}px)`, transition: pull ? "none" : "transform 200ms" }}
      >
        {busy ? (
          <Spinner size={18} />
        ) : (
          <RefreshCw size={18} strokeWidth={2} style={{ transform: `rotate(${pull * 3}deg)`, opacity: ready ? 1 : 0.5 }} />
        )}
      </div>
    </div>
  );
}

// The computer sidebar (user request 2026-10-31, replacing the icon rail: "icons not aligned, lines broken; buttons
// with clearer labels and better icons, resized to fit"; user's answers: labelled buttons with an option to shrink
// to icons only, the WorkDesk name at its top, only the logo when shrunk). Labelled: 176px of full-width buttons,
// icon and label on one line, in two groups (My work, Office), Settings and the shrink button pinned at the bottom.
// Shrunk: 72px of icons with their names as tooltips and screen-reader labels. Its top box has the top bar's exact
// height, so their bottom lines meet; the list scrolls inside a short window, never the top box or Settings.
const SIDEBAR_KEY = "workdesk-sidebar";
function useSidebarShrunk() {
  // Saved per device; until chosen, screens under 1280px wide (tablets, small laptops) start shrunk so the pages
  // keep their width.
  const [shrunk, setShrunk] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved) return saved === "icons";
    } catch {
      // storage refused (private window): fall back to the screen size
    }
    return window.innerWidth < 1280;
  });
  const toggle = () =>
    setShrunk((was) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, was ? "labels" : "icons");
      } catch {
        // not saved; still changes for now
      }
      return !was;
    });
  return [shrunk, toggle] as const;
}

const SIDE_GROUPS = [
  { key: "work", label: "My work" },
  { key: "office", label: "Office" },
] as const;

function Sidebar({ badge }: { badge: Record<string, number | undefined> }) {
  const [shrunk, toggle] = useSidebarShrunk();
  return (
    <aside className={cx("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-white transition-[width] duration-200 md:flex", shrunk ? "w-[72px]" : "w-44")}>
      {/* The same safe-area padding, height and line as the top bar, so the two lines meet. */}
      <div className="shrink-0 border-b border-line pt-[env(safe-area-inset-top)]">
        <Link to="/" title="WorkDesk" aria-label={shrunk ? "WorkDesk, Home" : undefined} className={cx("flex h-20 items-center gap-2.5", shrunk ? "justify-center" : "px-4")}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
            <CalendarCheck size={22} />
          </span>
          {!shrunk && (
            <span className="min-w-0 leading-tight">
              <span className="block text-headline font-semibold text-ink">WorkDesk</span>
              <TitleStatus below />
            </span>
          )}
        </Link>
      </div>
      <nav aria-label="Main" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {SIDE_GROUPS.map((g, i) => (
          <div key={g.key}>
            {shrunk ? (
              i > 0 && <div className="mx-2 my-2 h-px bg-line" aria-hidden />
            ) : (
              <p className="px-3 pt-3 pb-1 text-caption2 font-semibold tracking-wide text-slate-400 uppercase">{g.label}</p>
            )}
            <ul className={cx("space-y-1", shrunk && i === 0 && "pt-2")}>
              {NAV.filter((n) => n.group === g.key).map((n) => (
                <li key={n.to}>
                  <SideLink item={n} count={badge[n.to]} shrunk={shrunk} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cx("flex shrink-0 gap-1 border-t border-line p-2", shrunk && "flex-col")}>
        <div className="min-w-0 flex-1">
          <SideLink item={{ to: "/settings", label: "Settings", icon: SettingsIcon }} shrunk={shrunk} />
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={shrunk ? "Show the menu's labels" : "Shrink the menu to icons"}
          title={shrunk ? "Show labels" : "Shrink to icons"}
          className={cx("flex h-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-ink active:scale-90", shrunk ? "w-full" : "w-10")}
        >
          {shrunk ? <PanelLeftOpen size={20} strokeWidth={1.75} /> : <PanelLeftClose size={20} strokeWidth={1.75} />}
        </button>
      </div>
    </aside>
  );
}

function SideLink({ item, count, shrunk }: { item: NavItem; count?: number; shrunk: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      title={shrunk ? item.label : undefined}
      aria-label={shrunk ? `${item.label}${count ? `, ${count}` : ""}` : undefined}
      className={({ isActive }) =>
        cx(
          "group relative flex h-10 items-center rounded-lg text-sm transition active:scale-[0.97]",
          shrunk ? "justify-center" : "gap-3 px-3",
          isActive ? "bg-tint font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-2 -left-2 w-[3px] rounded-r-full bg-brand-600" aria-hidden />}
          <span className="relative shrink-0">
            <item.icon size={20} strokeWidth={isActive ? 2 : 1.75} />
            {shrunk && !!count && <CountDot n={count} className="-top-2 -right-3" />}
          </span>
          {!shrunk && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
          {!shrunk && !!count && (
            <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-caption2 leading-[18px] font-medium text-white tabular-nums">{count > 99 ? "99+" : count}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

function CountDot({ n, className, urgent }: { n: number; className?: string; urgent?: boolean }) {
  return (
    <span
      className={cx(
        "absolute min-w-[18px] rounded-full px-1 text-center text-caption2 leading-[18px] font-medium text-white tabular-nums",
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
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-4 md:h-20 md:gap-6 md:px-6 lg:px-8">
        {/* Phones only: computers have the name at the top of the sidebar (user request 2026-10-31). */}
        <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2.5 md:hidden">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white md:hidden">
            <CalendarCheck size={18} />
          </span>
          <span>
            <span className="block text-headline font-semibold text-ink md:text-2xl md:leading-tight">
              WorkDesk
              <TitleStatus />
            </span>
            <span className="hidden text-footnote text-slate-500 lg:block">Every email accounted for. Every task tracked.</span>
          </span>
        </Link>

        <form onSubmit={submit} className="relative mx-auto hidden w-full max-w-xl sm:block">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search emails and tasks…"
            aria-label="Search"
            className="h-11 w-full rounded-xl border border-line bg-canvas-soft pr-3 pl-10 text-sm placeholder:text-slate-400 focus:border-brand-200 focus:bg-white"
          />
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 pointer-coarse:gap-2">
          <Link to="/search" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 active:scale-90 sm:hidden pointer-coarse:p-2" aria-label="Search">
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

// Beside the title (user request 2026-10-07): the version for the first 5 seconds after the app opens, then
// the connection: a small yellow warning triangle when offline, a spinner while syncing, and a green tick with
// the time of the last sync. Tapping it says the same in words (and the version), so nothing is hover-only.
// below: on its own line under the name (the computer sidebar, 2026-10-31).
function TitleStatus({ below }: { below?: boolean }) {
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 5000);
    return () => clearTimeout(t);
  }, []);
  const { offline, lastSynced } = useConnection();
  // Any data being fetched or a change being saved; shown after a moment so quick requests don't flicker.
  const busy = useIsFetching() + useIsMutating() > 0;
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (!busy) return setSyncing(false);
    const t = setTimeout(() => setSyncing(true), 250);
    return () => clearTimeout(t);
  }, [busy]);

  const when = lastSynced ? formatWhen(new Date(lastSynced).toISOString()) : null;
  const text = offline
    ? `Offline. Showing what was saved${when ? ` at ${when}` : ""}; changes are sent when you're back online.`
    : syncing
      ? "Syncing…"
      : when
        ? `Synced at ${when}`
        : "Connected";
  const state = intro ? "version" : offline ? "offline" : syncing ? "syncing" : "synced";
  return (
    // Above the title link's own tap area (z-[1]) with a 44px tap area of its own, so a tap explains the
    // status instead of going Home.
    <span
      role="button"
      tabIndex={0}
      data-title-status
      aria-label={intro ? `Version ${__APP_VERSION__}` : text}
      title={`${text} · Version ${__APP_VERSION__}`}
      onClick={(e) => {
        if (intro) return;
        e.preventDefault(); // inside the title's link: explain instead of going Home
        showUndo({ message: offline ? (when ? `Offline · showing data saved ${when}` : "Offline · showing saved data") : `${text} · v${__APP_VERSION__}` });
      }}
      className={cx(
        "relative z-[1] items-center gap-1 align-baseline text-caption2 font-normal text-slate-400 after:absolute after:top-1/2 after:left-1/2 after:h-11 after:w-[max(100%,44px)] after:-translate-1/2 after:content-[''] md:text-xs",
        below ? "mt-0.5 flex w-fit" : "ml-1.5 inline-flex",
      )}
    >
      <span key={state} className="inline-flex animate-[fade-in_300ms_ease-out] items-center gap-1">
        {state === "version" && <>v{__APP_VERSION__}</>}
        {state === "offline" && <TriangleAlert size={14} strokeWidth={2.2} className="fill-medium text-[#7a5a00]" aria-hidden />}
        {state === "syncing" && <Spinner size={12} />}
        {state === "synced" && (
          <>
            <Check size={13} strokeWidth={3} className="text-low" aria-hidden />
            {when && <span className="tabular-nums">{when}</span>}
          </>
        )}
      </span>
    </span>
  );
}

// WorkDesk opened offline on a device where it was never loaded: nothing saved to show yet.
function OfflineStart({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas-soft px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-medium-soft text-medium-ink">
        <WifiOff size={24} />
      </span>
      <p className="font-semibold text-ink">You're offline</p>
      <p className="max-w-xs text-sm text-slate-600">Connect to the internet once to open WorkDesk on this device. After that it opens offline too, with what was saved.</p>
      <button onClick={() => (onRetry ? onRetry() : location.reload())} className="mt-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white active:scale-[0.97]">
        Try again
      </button>
    </div>
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
      className="relative rounded-lg p-2 text-slate-600 enabled:hover:bg-slate-100 enabled:hover:text-ink enabled:active:scale-90 disabled:opacity-60 pointer-coarse:p-2"
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

// Phone notifications (user request 2026-10-07): when the app opens it re-registers this device's notifications,
// and the app icon's red number follows Home's "Pending today" (due today + overdue).
function IconBadge() {
  const counts = useSummary().data?.counts;
  useEffect(() => {
    void refreshPushSubscription();
  }, []);
  useEffect(() => {
    if (counts) setIconBadge(counts.dueToday + counts.overdue + (counts.incrementsDue ?? 0));
  }, [counts]);
  return null;
}

function Notifications() {
  const summary = useSummary().data;
  const me = useMe().data;
  // Changes an assistant made that the user hasn't looked at (MCP Phase 5, user request 2026-10-19).
  const unseen = useAssistantUnseen().data;
  const { open, setOpen, ref } = usePopover();
  const navigate = useNavigate();

  const items: { key: string; tone: Tone; title: string; detail: string; to: string }[] = [];
  if (me?.account?.lastSyncError) items.push({ key: "sync", tone: "urgent", title: "Gmail sync failed", detail: me.account.lastSyncError.slice(0, 90), to: "/settings" });
  for (const t of summary?.overdue ?? []) items.push({ key: `o${t.id}`, tone: "urgent", title: "Overdue", detail: t.title, to: "/tasks?view=overdue" });
  for (const t of summary?.newActivity ?? []) items.push({ key: `n${t.id}`, tone: "brand", title: "New reply on a task", detail: t.title, to: "/tasks" });
  for (const t of summary?.dueToday ?? []) items.push({ key: `d${t.id}`, tone: "high", title: "Due today", detail: t.title, to: "/tasks?view=today" });
  // Newest first, at the top of the list.
  const fromAssistant: typeof items = (unseen?.latest ?? []).map((l) => ({ key: `a${l.id}`, tone: "brand", title: `${l.clientName || "Assistant"}: ${l.title}`, detail: l.touched.map((t) => t.title).filter(Boolean).join(" · ") || l.title, to: "/settings#assistant" }));
  if (unseen && unseen.count > unseen.latest.length) fromAssistant.push({ key: "a-more", tone: "brand", title: "Assistant", detail: `${unseen.count - unseen.latest.length} more changes`, to: "/settings#assistant" });
  items.unshift(...fromAssistant);
  const alertCount = items.filter((i) => i.tone !== "high").length;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-ink active:scale-90 aria-expanded:bg-slate-100 pointer-coarse:p-2" aria-label={`Notifications (${alertCount})`} aria-expanded={open}>
        <Bell size={21} strokeWidth={1.8} />
        {alertCount > 0 && <CountDot n={alertCount} urgent className="-top-0.5 -right-0.5" />}
      </button>
      {open && (
        <PopPanel onClose={() => setOpen(false)} className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white shadow-xl">
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
        </PopPanel>
      )}
    </div>
  );
}

function UserMenu() {
  const me = useMe().data;
  const { open, setOpen, ref } = usePopover();
  const phone = usePhone();
  const name = me?.name ?? me?.email ?? "";
  const accountLine = me?.demo ? "Demo mode · sample emails" : (me?.account?.email ?? me?.email);
  // Phones: a panel from the right edge, where the profile picture is (user request 2026-10-07).
  // Big rows (user request 2026-10-07: "increase size of buttons in the side panel").
  const sideRow = "flex min-h-14 w-full items-center gap-4 px-5 py-3.5 text-left text-body text-ink active:bg-slate-100";
  const panel = open && phone && (
    <SidePanel onClose={() => setOpen(false)} label="Account">
      <div className="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4">
        <Avatar name={name} src={me?.picture} size={52} />
        <div className="min-w-0 flex-1 pt-1">
          <div className="text-headline font-semibold [overflow-wrap:anywhere]">{name}</div>
          <div className="truncate text-footnote text-slate-500">{accountLine}</div>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close" className="-mt-1 -mr-2 rounded-lg p-2 text-slate-500 active:scale-90">
          <X size={20} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {[
          { to: "/events", label: "Events", icon: Presentation },
          { to: "/employees", label: "Employees", icon: UsersRound },
          { to: "/leave", label: "Leave", icon: TreePalm },
          { to: "/attendance", label: "Attendance", icon: ClipboardCheck },
          { to: "/files", label: "File register", icon: FolderOpen },
          { to: "/registers", label: "Registers", icon: NotebookPen },
          { to: "/logins", label: "Logins", icon: KeyRound },
          { to: "/settings", label: "Settings", icon: SettingsIcon },
        ].map((l) => (
          <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)} className={({ isActive }) => cx(sideRow, isActive && "bg-tint font-medium text-brand-800")}>
            <l.icon size={24} className="shrink-0 text-slate-500" /> {l.label}
          </NavLink>
        ))}
      </nav>
      {!me?.demo && (
        <button onClick={() => logout().then(() => location.assign("/"))} className={cx(sideRow, "border-t border-line text-urgent-ink")}>
          <LogOut size={24} className="shrink-0" /> Sign out
        </button>
      )}
    </SidePanel>
  );
  return (
    <div className="relative ml-1" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl py-1 pr-1 pl-1 hover:bg-slate-100 active:scale-[0.97] aria-expanded:bg-slate-100 md:pr-2" aria-expanded={open} aria-label="Account menu">
        <Avatar name={name} src={me?.picture} size={40} />
        <span className="hidden max-w-36 truncate text-sm font-medium text-ink md:block">{name}</span>
        <ChevronDown size={16} className="hidden text-slate-500 md:block" />
      </button>
      {panel}
      {open && !phone && (
        <PopPanel onClose={() => setOpen(false)} title="Account" className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-line bg-white p-1 shadow-xl">
          <div className="px-3 py-2.5">
            <div className="truncate text-sm font-medium text-ink">{name}</div>
            <div className="truncate text-xs text-slate-500">{me?.demo ? "Demo mode · sample emails" : (me?.account?.email ?? me?.email)}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link to="/events" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <Presentation size={16} /> Events
          </Link>
          {/* Employees (formerly Staff, user request 2026-10-07): next to Settings in the profile menu. */}
          <Link to="/employees" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <UsersRound size={16} /> Employees
          </Link>
          <Link to="/leave" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <TreePalm size={16} /> Leave
          </Link>
          <Link to="/attendance" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <ClipboardCheck size={16} /> Attendance
          </Link>
          <Link to="/files" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <FolderOpen size={16} /> File register
          </Link>
          <Link to="/registers" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <NotebookPen size={16} /> Registers
          </Link>
          <Link to="/logins" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <KeyRound size={16} /> Logins
          </Link>
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
        </PopPanel>
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
