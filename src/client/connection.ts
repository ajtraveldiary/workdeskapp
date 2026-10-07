// Connection status for the title bar (user request 2026-10-07: offline viewing with a yellow warning,
// a spinner while syncing and a green tick with the time when done).
//  - Offline: the device says so, or a request couldn't reach the server (or was answered from the offline
//    copy kept by the service worker). TanStack Query is then told it is offline, so screens keep showing
//    the saved data and changes wait (they are sent when the connection is back, if the app stays open).
//  - While offline, a tiny version check runs every 15 seconds to notice when the connection is back.
//  - lastSynced: when the server last answered (starts from the newest saved data).
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { queryClient } from "./queryClient";

type State = { offline: boolean; lastSynced: number | null };
let state: State = { offline: typeof navigator !== "undefined" && navigator.onLine === false, lastSynced: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

let probe: ReturnType<typeof setInterval> | null = null;
function goOffline() {
  if (!state.offline) set({ offline: true });
  onlineManager.setOnline(false);
  probe ??= setInterval(() => {
    fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.ok && goOnline(), () => undefined);
  }, 15_000);
}
function goOnline() {
  if (probe) clearInterval(probe);
  probe = null;
  if (state.offline) set({ offline: false });
  onlineManager.setOnline(true); // paused requests and changes carry on
}

// Called by api() for every request.
export function noteResponse(fromOfflineCopy: boolean) {
  if (fromOfflineCopy) return goOffline();
  set({ lastSynced: Date.now() });
  if (state.offline) goOnline();
}
export function noteNetworkError() {
  goOffline();
}

export function watchConnection() {
  window.addEventListener("offline", goOffline);
  window.addEventListener("online", goOnline);
  if (navigator.onLine === false) goOffline();
}

function newestSaved() {
  const times = queryClient.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt);
  return times.length ? Math.max(...times) || null : null;
}

export function useConnection(): State {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
  return s.lastSynced ? s : { ...s, lastSynced: newestSaved() };
}

// While online, quietly fetch the main lists once in a while so the offline helper has a copy of each screen,
// even ones not opened recently (at most every 30 minutes; only when the helper is running).
const WARM_EVERY = 30 * 60_000;
const WARM_KEY = "workdesk-offline-warmed";
const WARM_URLS = [
  "/api/summary",
  "/api/tasks?view=all",
  "/api/tasks?view=today",
  "/api/tasks?view=overdue",
  "/api/tasks?view=upcoming",
  "/api/tasks?view=nodate",
  "/api/threads?state=needs_decision",
  "/api/threads?state=task",
  "/api/threads?state=all",
  "/api/threads?state=all&limit=100",
  "/api/reports",
  "/api/labels",
];
export function warmOfflineCopy() {
  if (state.offline || !navigator.serviceWorker?.controller) return;
  try {
    const last = Number(localStorage.getItem(WARM_KEY) ?? 0);
    if (Date.now() - last < WARM_EVERY) return;
    localStorage.setItem(WARM_KEY, String(Date.now()));
  } catch {
    return;
  }
  // One after another, so the server is never asked for many at once.
  void WARM_URLS.reduce<Promise<unknown>>((prev, url) => prev.then(() => fetch(url, { credentials: "same-origin" }).catch(() => undefined)), Promise.resolve());
}
