// The background queue's kinds of work (user request 2026-10-23, "a queue system so that no service gets lost,
// and let the user view it"): what each is called in Settings › Queue, the order a run takes them in, and the
// calls (database queries + Gmail requests) one needs at the least before it is started.
// The four background kinds are put in by every run; `action` (one of your changes that failed and was saved to be
// tried again) and `push` (a phone notification a push service refused) come from failures (user request
// 2026-10-23, "every subrequest logged, failed ones stored for retry").
export const BACKGROUND_KINDS = ["notify", "sync", "labels", "upkeep"] as const;
export const JOB_KINDS = ["notify", "push", "action", "sync", "labels", "upkeep"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];
export const isBackgroundKind = (k: string): k is BackgroundKind => (BACKGROUND_KINDS as readonly string[]).includes(k);

export const JOB_INFO: Record<JobKind, { title: string; about: string; needs: number }> = {
  notify: { title: "Phone notifications", about: "Due-time notes and the morning summary", needs: 6 },
  push: { title: "Phone notification", about: "One notification a push service refused, sent again", needs: 5 },
  action: { title: "Your change", about: "A change that couldn't finish, done again through the app", needs: 8 },
  sync: { title: "Gmail sync", about: "New emails, read / unread and label changes", needs: 12 },
  labels: { title: "Gmail task labels", about: "Puts the task / done label on task emails that miss it", needs: 6 },
  upkeep: { title: "Upkeep", about: "Reminder dates, pension, contract, probation and event tasks, snoozed emails", needs: 15 },
};

// `check`: a saved change that had already saved part of itself, so it waits for the user's Retry or Discard.
export const JOB_STATUSES = ["queued", "running", "done", "failed", "check"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// Tries before a job is left as failed (it can be retried from Settings › Queue).
export const JOB_MAX_ATTEMPTS = 5;
// A job still "running" this long after it started was cut off (the run ended); it is queued again.
export const JOB_STALE_MINUTES = 5;
// A refused phone notification is not sent again after this long.
export const PUSH_RETRY_HOURS = 2;

// Minutes to wait before try n + 1 (2, 4, 8, 16).
export const retryDelayMinutes = (attempts: number) => 2 ** Math.min(attempts, 4);

// Plain names for requests in the calls log and for saved changes ("POST /api/tasks/…/complete" → "Complete task").
const TITLES: [RegExp, string][] = [
  [/^GET \/api\/summary/, "Home"],
  [/^GET \/api\/me$/, "Sign-in check"],
  [/^GET \/api\/threads\/[^/]+\/content/, "Open email"],
  [/^GET \/api\/threads\/[^/]+\/messages\/[^/]+\/parts\//, "Open attachment"],
  [/^GET \/api\/threads/, "Emails"],
  [/^GET \/api\/tasks/, "Tasks"],
  [/^GET \/api\/reports/, "Reminders"],
  [/^GET \/api\/staff/, "Employees"],
  [/^GET \/api\/history/, "History"],
  [/^GET \/api\/queue\/calls/, "Calls log"],
  [/^GET \/api\/queue/, "Queue check"],
  [/^GET \/api\/calendar\//, "Calendar feed"],
  [/^POST \/api\/sync$/, "Sync now"],
  [/^POST \/api\/maintain$/, "Refresh"],
  [/^POST \/api\/queue\/run$/, "Run now"],
  [/^POST \/api\/threads\/[^/]+\/read$/, "Mark email read"],
  [/^POST \/api\/threads\/[^/]+\/task$/, "Create task from email"],
  [/^POST \/api\/threads\/bulk-task/, "Create tasks from emails"],
  [/^POST \/api\/threads\/[^/]+\/dismiss$|^POST \/api\/threads\/bulk-dismiss/, "Remove email"],
  [/^POST \/api\/threads\/[^/]+\/restore$|^POST \/api\/threads\/bulk-restore/, "Restore email"],
  [/^POST \/api\/threads\/bulk-section/, "Send to section"],
  [/^(POST|DELETE) \/api\/threads\/[^/]+\/labels/, "Change email labels"],
  [/^POST \/api\/labels$/, "Create label"],
  [/^PATCH \/api\/labels\//, "Change label"],
  [/^DELETE \/api\/labels\//, "Delete label"],
  [/^POST \/api\/tasks\/[^/]+\/complete$/, "Complete task"],
  [/^POST \/api\/tasks\/[^/]+\/reopen$/, "Reopen task"],
  [/^POST \/api\/tasks\/bulk-delete/, "Delete tasks"],
  [/^POST \/api\/tasks$/, "Create task"],
  [/^PATCH \/api\/tasks\//, "Change task"],
  [/^DELETE \/api\/tasks\//, "Delete task"],
  [/^POST \/api\/reports$/, "Create reminder"],
  [/^(PATCH|PUT) \/api\/reports\//, "Change reminder"],
  [/^POST \/api\/reports\/periods\//, "Mark reminder date"],
  [/^POST \/api\/staff\/employees$/, "Add employee"],
  [/^PUT \/api\/staff\/employees\//, "Change employee"],
  [/^POST \/api\/staff\/employees\/[^/]+\/increment/, "Mark increment done"],
  [/^POST \/api\/moves/, "Joining / relieving"],
  [/^POST \/api\/office-events/, "Event"],
  [/^POST \/api\/register-entries/, "Register entry"],
  [/^POST \/api\/files|^PUT \/api\/files/, "File register"],
  [/^POST \/api\/mcp/, "Assistant"],
];

export function requestTitle(method: string, path: string) {
  const line = `${method} ${path.split("?")[0]}`;
  return TITLES.find(([re]) => re.test(line))?.[1] ?? line;
}
