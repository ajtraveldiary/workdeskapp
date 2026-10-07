import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import {
  CalendarClock,
  Bell,
  CalendarDays,
  Check,
  TriangleAlert,
  WifiOff,
  CalendarCheck,
  ChevronDown,
  History as HistoryIcon,
  UsersRound,
  FolderOpen,
  X,
  House,
  ListChecks,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { ApiError, logout, useMe, useSummary, useSync } from "./api";
import { useConnection, warmOfflineCopy } from "./connection";
import { isDbIssue } from "./dbStatus";
import { DatabaseIssueDialog, DatabaseIssuePage } from "./components/DatabaseIssue";
import { formatWhen } from "./format";
import { Avatar } from "./components/Avatar";
import { UndoBar, showUndo } from "./components/SwipeRow";
import { WaitDialogHost } from "./components/Waiting";
import { RemoveChooserHost } from "./components/RemoveChooser";
import { SidePanel } from "./components/SidePanel";
import { usePhone } from "./components/sheet";
import { refreshPushSubscription, setIconBadge } from "./push";
import { PopPanel, Spinner, Splash, TONE, cx, type Tone } from "./components/ui";
import { HomePage } from "./pages/Home";
import { InboxPage } from "./pages/Inbox";
import { TasksPage } from "./pages/Tasks";
import { CalendarPage } from "./pages/Calendar";
import { SearchPage } from "./pages/Search";
import { HistoryPage } from "./pages/History";
import { StaffPage } from "./pages/Staff";
import { FilesPage } from "./pages/Files";
import { RemindersPage } from "./pages/Reminders";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";

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
        <Route path="/inbox" element={<Page><InboxPage /></Page>} />
        <Route path="/tasks" element={<Page><TasksPage /></Page>} />
        <Route path="/calendar" element={<Page wide><CalendarPage /></Page>} />
        <Route path="/reminders" element={<Page><RemindersPage /></Page>} />
        <Route path="/reports" element={<Navigate to="/reminders" replace />} />
        <Route path="/history" element={<Page><HistoryPage /></Page>} />
        <Route path="/search" element={<Page><SearchPage /></Page>} />
        <Route path="/settings" element={<Page><SettingsPage /></Page>} />
        <Route path="/staff" element={<Page><StaffPage /></Page>} />
        <Route path="/files" element={<Page><FilesPage /></Page>} />
        <Route path="*" element={<Page><p className="text-slate-500">Page not found.</p></Page>} />
      </Routes>
    </Shell>
  );
}

function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  // Left-aligned like Home, so page titles line up with the top bar on every screen (alignment pass 2026-10-06).
  return <div className={cx("w-full px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:px-8", wide ? "max-w-7xl" : "max-w-5xl")}>{children}</div>;
}

type NavItem = { to: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/inbox", label: "Emails", icon: Mail },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/reminders", label: "Reminders", icon: CalendarClock },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/history", label: "History", icon: HistoryIcon },
  // Staff page (user request 2026-10-07): in the side rail on wider screens, in the profile menu on phones.
  { to: "/staff", label: "Staff", icon: UsersRound },
  // File register (user request 2026-10-07), next to Staff: rail on wider screens, profile menu on phones.
  { to: "/files", label: "Files", icon: FolderOpen },
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
      <IconBadge />
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <main ref={mainRef} className="app-main relative min-h-0 flex-1 pb-[calc(var(--tabbar-h)+1rem+env(safe-area-inset-bottom))] md:pb-0">
          <PullToRefresh scroller={mainRef} />
          {/* Each new page slides up and fades in (user request 2026-10-07; .page-in in styles.css). */}
          <div key={pathname} className="page-in">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation (History lives in Settings on phones, user request 2026-10-06): standard app tab bar (user request 2026-10-06), clear of the iPhone's rounded
          corners and home bar via the safe-area insets (needs viewport-fit=cover in index.html). */}
      <nav className="tabbar fixed inset-x-0 bottom-0 z-20 grid h-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-white/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden">
        {NAV.filter((n) => n.to !== "/history" && n.to !== "/staff" && n.to !== "/files").map((n) => (
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

function RailLink({ item, count }: { item: NavItem; count?: number }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cx(
          "group relative flex flex-col items-center gap-1 border-l-[3px] py-3.5 text-footnote transition active:bg-slate-100",
          isActive ? "border-brand-600 bg-tint font-medium text-brand-700" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-ink",
        )
      }
    >
      <span className="relative transition-transform group-hover:scale-110 group-active:scale-95">
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
        <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2.5">
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
function TitleStatus() {
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
      className="relative z-[1] ml-1.5 inline-flex items-center gap-1 align-baseline text-caption2 font-normal text-slate-400 after:absolute after:top-1/2 after:left-1/2 after:h-11 after:w-[max(100%,44px)] after:-translate-1/2 after:content-[''] md:text-xs"
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
  const sideRow = "flex min-h-11 w-full items-center gap-3 px-5 py-2.5 text-left text-subhead text-ink active:bg-slate-100";
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
          { to: "/staff", label: "Staff", icon: UsersRound },
          { to: "/files", label: "File register", icon: FolderOpen },
          { to: "/settings", label: "Settings", icon: SettingsIcon },
        ].map((l) => (
          <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)} className={({ isActive }) => cx(sideRow, isActive && "bg-tint font-medium text-brand-800")}>
            <l.icon size={20} className="shrink-0 text-slate-500" /> {l.label}
          </NavLink>
        ))}
      </nav>
      {!me?.demo && (
        <button onClick={() => logout().then(() => location.assign("/"))} className={cx(sideRow, "border-t border-line text-urgent-ink")}>
          <LogOut size={20} className="shrink-0" /> Sign out
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
          {/* Staff (user request 2026-10-07): next to Settings in the profile menu. */}
          <Link to="/staff" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <UsersRound size={16} /> Staff
          </Link>
          <Link to="/files" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
            <FolderOpen size={16} /> File register
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
