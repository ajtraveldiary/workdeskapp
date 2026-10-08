import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { reportDbIssue } from "./dbStatus";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

// Hybrid storage: what the dashboard has loaded is kept in this browser's localStorage, so screens open
// instantly from the saved copy and the database is only asked again when data is older than STALE
// (or after a change, or a manual refresh). The database stays the source of truth.
const STALE = 5 * 60_000;
// Kept a week so WorkDesk can be read offline (user request 2026-10-07; was a day).
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60_000;

export const queryClient = new QueryClient({
  // A database problem in any request opens the "database paused / error" pop-up (App.tsx).
  queryCache: new QueryCache({ onError: reportDbIssue }),
  mutationCache: new MutationCache({ onError: reportDbIssue }),
  defaultOptions: {
    queries: {
      staleTime: STALE,
      gcTime: CACHE_MAX_AGE, // must be at least the persisted max age
      refetchOnWindowFocus: false,
      retry: 1,
      // Offline (user request 2026-10-07): still ask once, so the offline helper (src/sw/sw.js) can answer
      // from its saved copy; only retries wait for the connection.
      networkMode: "offlineFirst",
    },
  },
});

// localStorage can be unavailable (private window, blocked site data); the app then just works without it.
function browserStorage(): Storage | undefined {
  try {
    const s = window.localStorage;
    s.setItem("workdesk-probe", "1");
    s.removeItem("workdesk-probe");
    return s;
  } catch {
    return undefined;
  }
}

export const persister = createSyncStoragePersister({ storage: browserStorage(), key: "workdesk-cache", throttleTime: 1000 });

// Bump to discard everyone's saved copy after a change to the data's shape.
// 2: tasks and reports carry labelIds instead of categoryId (2026-10-06).
// 3: reports became reminders (repeat, startDate…) and task-label settings gained autoDoneLabelIds (2026-10-06).
// 4: tasks carry a checklist (2026-10-07).
// 5: reminders (and reminder tasks' report) carry links (2026-10-07).
// 6: tasks carry waitingSince/replyBy and the summary counts waiting tasks (2026-10-07).
// 7: the summary counts jobTasks and remindersDue (2026-10-07).
// 8: emails can be "elsewhere" (Other sections) and carry sectionLabelId; label settings have organizeLabelIds (2026-10-07).
// 9: tasks and reminders carry relatedKind/relatedId (Staff page, 2026-10-07).
// 10: the summary lists incrementsDue (Staff, 2026-10-07).
// 11: employees are permanent or temporary (permanent, engagedTill), 2026-10-07.
// 12: the staff list has types; employees carry engagement, typeId, contractDays, payPerDay (2026-10-07).
// 13: the summary lists contractsEnding (temporary employees, 2026-10-08).
// 14: tasks carry madeBySystem (Pension papers tasks, 2026-10-08).
export const CACHE_VERSION = "14";

export async function clearSavedData() {
  queryClient.clear();
  try {
    await persister.removeClient();
  } catch {
    // nothing saved
  }
}
