// Background queue (user request 2026-10-23, "implement a queue system so that no service gets lost, and let the
// user view it"). The 10-minute cron, Sync now and Settings › Queue's Run now each run it: they put in one job per
// kind of work that isn't already waiting (shared/jobs.ts), claim the due ones and run them in order inside the
// run's calls budget (callBudget.ts). A job that would not fit, or runs out of calls part way, goes back in the
// queue for the next run (a pause, not a failure); a job that fails is tried again later (2, 4, 8, 16 minutes)
// and after JOB_MAX_ATTEMPTS tries stays "failed" until retried from Settings. Nothing is dropped.
import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { DB } from "../db";
import { gmailAccounts, jobs, users } from "../db/schema";
import { timezone, type Env } from "../env";
import { JOB_INFO, JOB_KINDS, JOB_MAX_ATTEMPTS, JOB_STALE_MINUTES, retryDelayMinutes, type JobKind } from "../../shared/jobs";
import { callsLeft, currentBudget, isOutOfCalls, spare } from "./callBudget";
import { todayIn } from "./dates";
import { maintain } from "./maintenance";
import { sendPushTo } from "./notify";
import { syncAccount } from "./sync";
import { labelTaskEmails } from "./taskLabels";
import type { QueueRunReport } from "../../shared/types";

type Job = typeof jobs.$inferSelect;
type Outcome = { note: string; more?: boolean; fetched?: number; remaining?: number };

// Runs that ran out of calls in a row before a job is given up as too big for one run.
const MAX_PAUSES = 6;
// Finished jobs kept for Settings › Queue: done ones 2 days, failed ones 30 days (cleared by upkeep).
const KEEP_DONE_DAYS = 2;
const KEEP_FAILED_DAYS = 30;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const RUNNERS: Record<JobKind, (db: DB, env: Env, job: Job) => Promise<Outcome>> = {
  notify: async (db, env, job) => {
    const n = await sendPushTo(db, env, job.userId);
    return { note: n ? `Sent ${plural(n, "notification")}` : "Nothing due" };
  },

  sync: async (db, env, job) => {
    const accounts = (await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, job.userId))).filter((a) => a.refreshTokenEnc);
    if (!accounts.length) return { note: "No Gmail account connected" };
    // After a pause, a smaller batch each time, so a sync too big for one run still moves on.
    const batch = Number(env.SYNC_BATCH || 30);
    const maxDownloads = job.pauses ? Math.max(1, Math.floor(batch / 2 ** job.pauses)) : undefined;
    let fetched = 0;
    let remaining = 0;
    for (const a of accounts) {
      try {
        const r = await syncAccount(db, env, a, false, { maxDownloads });
        fetched += r.fetched;
        remaining += r.remaining;
      } catch (e) {
        // Running out of calls isn't a sync problem; anything else shows in Settings › General as before.
        if (!isOutOfCalls(e)) {
          const msg = e instanceof Error ? e.message : String(e);
          await db.update(gmailAccounts).set({ lastSyncError: msg.slice(0, 500) }).where(eq(gmailAccounts.id, a.id));
        }
        throw e;
      }
    }
    return {
      note: `${fetched ? `Downloaded ${plural(fetched, "email")}` : "No new emails"}${remaining ? `; ${remaining} more waiting` : ""}`,
      more: remaining > 0,
      fetched,
      remaining,
    };
  },

  labels: async (db, env, job) => {
    // About two calls per email (the Gmail change and saving it), after a few lookups.
    const limit = Math.min(20, Math.floor((callsLeft() - 6) / 2));
    const r = await labelTaskEmails(db, env, job.userId, Math.max(1, limit));
    return { note: r.labelled ? `Labelled ${plural(r.labelled, "email")}${r.remaining ? `; ${r.remaining} more waiting` : ""}` : r.remaining ? `${r.remaining} waiting` : "All labelled", more: r.remaining > 0 };
  },

  upkeep: async (db, env, job) => {
    await maintain(db, job.userId, todayIn(timezone(env)), true);
    await db
      .delete(jobs)
      .where(
        and(
          eq(jobs.userId, job.userId),
          sql`(${jobs.status} = 'done' and ${jobs.finishedAt} < now() - make_interval(days => ${KEEP_DONE_DAYS}))
            or (${jobs.status} = 'failed' and ${jobs.finishedAt} < now() - make_interval(days => ${KEEP_FAILED_DAYS}))`,
        ),
      );
    return { note: "Reminder dates and automatic tasks checked" };
  },
};

const order = (k: JobKind) => JOB_KINDS.indexOf(k);

// One user's queue. `kinds`: which kinds of work to put in (all of them for the schedule; Sync now only asks for a
// sync and labels); jobs already waiting of any kind are taken too.
export async function runQueue(db: DB, env: Env, userId: string, ranBy: "schedule" | "app", kinds: readonly JobKind[] = JOB_KINDS): Promise<QueueRunReport> {
  const budget = currentBudget();
  const report: QueueRunReport = { ran: [], more: false, fetched: 0, remaining: 0 };
  const now = new Date();

  // One waiting or running job per kind at most (the jobs_active index), so this adds only what isn't there.
  await db.insert(jobs).values(kinds.map((kind) => ({ userId, kind }))).onConflictDoNothing();
  // Jobs a run left "running" when it was cut off go back in the queue.
  await db
    .update(jobs)
    .set({ status: "queued", startedAt: null, note: "The run that started it was cut off; queued again", updatedAt: now })
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "running"), lt(jobs.startedAt, new Date(now.getTime() - JOB_STALE_MINUTES * 60_000))));
  // Claimed in one go, so two runs at once never take the same job. Due by the database's clock, which also
  // stamped the jobs just put in.
  const claimed = (
    await db
      .update(jobs)
      .set({ status: "running", startedAt: now, updatedAt: now })
      .where(and(eq(jobs.userId, userId), eq(jobs.status, "queued"), lte(jobs.runAfter, sql`now()`)))
      .returning()
  ).sort((a, b) => order(a.kind) - order(b.kind));

  const notRun: string[] = [];
  for (const job of claimed) {
    // Too few calls left to start it: it waits for the next run (cheaper jobs after it may still fit).
    if (callsLeft() < JOB_INFO[job.kind].needs) {
      notRun.push(job.id);
      continue;
    }
    const start = budget?.used ?? 0;
    if (budget) budget.ranOut = false;
    let set: Partial<typeof jobs.$inferInsert>;
    try {
      const o = await RUNNERS[job.kind](db, env, job);
      if (budget?.ranOut) throw new Error("ran out"); // part of it swallowed a refused call: not finished
      set = { status: "done", finishedAt: new Date(), pauses: 0, note: o.note };
      report.ran.push({ kind: job.kind, result: "done", note: o.note });
      if (o.more) report.more = true;
      report.fetched += o.fetched ?? 0;
      report.remaining += o.remaining ?? 0;
    } catch (e) {
      const limit = budget && Number.isFinite(budget.limit) ? budget.limit : null;
      if (isOutOfCalls(e) || budget?.ranOut) {
        const pauses = job.pauses + 1;
        if (pauses >= MAX_PAUSES) {
          const note = `Needs more calls than one run allows${limit ? ` (${limit})` : ""}, ${pauses} runs in a row`;
          set = { status: "failed", finishedAt: new Date(), pauses, note };
          report.ran.push({ kind: job.kind, result: "failed", note });
        } else {
          const note = `Paused: this run's ${limit ? `${limit} ` : ""}calls ran out. It carries on in the next run.`;
          set = { status: "queued", startedAt: null, pauses, note };
          report.ran.push({ kind: job.kind, result: "paused", note });
          report.more = true;
          report.remaining += 1;
        }
      } else {
        const attempts = job.attempts + 1;
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        if (attempts >= JOB_MAX_ATTEMPTS) {
          set = { status: "failed", finishedAt: new Date(), attempts, note: msg };
          report.ran.push({ kind: job.kind, result: "failed", note: msg });
        } else {
          set = { status: "queued", startedAt: null, attempts, runAfter: new Date(Date.now() + retryDelayMinutes(attempts) * 60_000), note: msg };
          report.ran.push({ kind: job.kind, result: "retry", note: msg });
        }
      }
    }
    const calls = (budget?.used ?? 0) - start;
    await spare(() => db.update(jobs).set({ ...set, calls, ranBy, updatedAt: new Date() }).where(eq(jobs.id, job.id)));
  }
  if (notRun.length) {
    report.more = true;
    await spare(() => db.update(jobs).set({ status: "queued", startedAt: null, updatedAt: new Date() }).where(inArray(jobs.id, notRun)));
  }
  return report;
}

// The 10-minute cron (worker.ts) and the dev server's timer: every user's queue within the one budget.
export async function runScheduledQueue(db: DB, env: Env) {
  const all = await db.select({ id: users.id }).from(users);
  for (const u of all) {
    if (callsLeft() < 8) break; // the next run carries on
    await runQueue(db, env, u.id, "schedule").catch((e) => console.error("Queue run failed:", e));
  }
}
