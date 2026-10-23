// The background queue's kinds of work (user request 2026-10-23, "a queue system so that no service gets lost,
// and let the user view it"): what each is called in Settings › Queue, the order a run takes them in, and the
// calls (database queries + Gmail requests) one needs at the least before it is started.
export const JOB_KINDS = ["notify", "sync", "labels", "upkeep"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_INFO: Record<JobKind, { title: string; about: string; needs: number }> = {
  notify: { title: "Phone notifications", about: "Due-time notes and the morning summary", needs: 6 },
  sync: { title: "Gmail sync", about: "New emails, read / unread and label changes", needs: 12 },
  labels: { title: "Gmail task labels", about: "Puts the task / done label on task emails that miss it", needs: 6 },
  upkeep: { title: "Upkeep", about: "Reminder dates, pension, contract, probation and event tasks, snoozed emails", needs: 15 },
};

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// Tries before a job is left as failed (it can be retried from Settings › Queue).
export const JOB_MAX_ATTEMPTS = 5;
// A job still "running" this long after it started was cut off (the run ended); it is queued again.
export const JOB_STALE_MINUTES = 5;

// Minutes to wait before try n + 1 (2, 4, 8, 16).
export const retryDelayMinutes = (attempts: number) => 2 ** Math.min(attempts, 4);
