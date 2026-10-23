// Settings › Queue (user request 2026-10-23): the background queue's jobs, Run now, Retry and Discard, and the calls
// log (every outgoing call each request or 10-minute run made). Runs started here use the request's own calls budget
// (SUBREQUEST_LIMIT), like the cron's.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { AppEnv } from "../app";
import { callLogs, events, jobs, type JobPayload } from "../db/schema";
import type { Env } from "../env";
import type { DB } from "../db";
import { callLimit, currentBudget, newBudget, withCalls } from "../lib/callBudget";
import { runQueue } from "../lib/queue";
import { isBackgroundKind, requestTitle, type BackgroundKind } from "../../shared/jobs";
import type { CallLog, QueueInfo, QueueJob } from "../../shared/types";

// The newest finished jobs shown beside everything still waiting, and calls log rows per page.
const SHOWN = 60;
const PAGE = 50;

// Inside a request the request's own budget is used, so the queue's calls show in that request's log.
export const runQueueNow = (db: DB, env: Env, userId: string, kinds?: readonly BackgroundKind[]) =>
  currentBudget() ? runQueue(db, env, userId, "app", kinds) : withCalls(newBudget(callLimit(env)), () => runQueue(db, env, userId, "app", kinds));

const requestOf = (p: JobPayload | null) => (p && "method" in p ? `${p.method} ${p.path.split("?")[0]}` : null);

export const queueRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.get("db").select().from(jobs).where(eq(jobs.userId, c.get("userId"))).orderBy(desc(jobs.updatedAt)).limit(SHOWN);
    const limit = callLimit(c.env);
    // The saved body stays on the server.
    const list = rows.map(({ payload, ...j }) => ({ ...j, request: requestOf(payload) }));
    return c.json({ limit: Number.isFinite(limit) ? limit : null, jobs: list as unknown as QueueJob[] } satisfies QueueInfo);
  })

  // Calls log, newest first: ?failed=1 only rows with a failed call, ?self=1 includes the queue page's own checks,
  // ?before=<time> the next page. The 10-minute runs (no user) are shown too.
  .get("/calls", async (c) => {
    const db = c.get("db");
    const before = c.req.query("before");
    const rows = await db
      .select()
      .from(callLogs)
      .where(
        and(
          or(eq(callLogs.userId, c.get("userId")), isNull(callLogs.userId)),
          c.req.query("failed") ? gt(callLogs.failed, 0) : undefined,
          c.req.query("self") ? undefined : eq(callLogs.selfCheck, false),
          before ? lt(callLogs.startedAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(callLogs.startedAt))
      .limit(PAGE + 1);
    const calls: CallLog[] = rows.slice(0, PAGE).map((r) => {
      const [method = "", path = ""] = r.request.split(" ");
      return {
        id: r.id,
        source: r.source,
        request: r.request,
        title: r.source === "schedule" ? "Every 10 minutes" : requestTitle(method, path),
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        ms: r.ms,
        calls: r.calls,
        limit: r.limit,
        failed: r.failed,
        ranOut: r.ranOut,
        selfCheck: r.selfCheck,
        jobId: r.jobId,
        entries: r.entries,
      };
    });
    return c.json({ calls, more: rows.length > PAGE });
  })

  .post("/run", async (c) => c.json(await runQueueNow(c.get("db"), c.env, c.get("userId"))))

  // A failed job, or a saved change waiting for the user's check: queued again from the start and run now. A
  // background kind gets a fresh job (if one is already waiting, that one covers it).
  .post("/:id/retry", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const mine = and(eq(jobs.id, c.req.param("id")), eq(jobs.userId, userId), inArray(jobs.status, ["failed", "check"]));
    const [job] = await db.select().from(jobs).where(mine);
    if (!job) throw new HTTPException(404, { message: "Nothing to retry" });
    if (isBackgroundKind(job.kind)) {
      await db.delete(jobs).where(eq(jobs.id, job.id));
      return c.json(await runQueueNow(db, c.env, userId, [job.kind]));
    }
    await db
      .update(jobs)
      .set({ status: "queued", attempts: 0, pauses: 0, runAfter: new Date(0), finishedAt: null, note: "Retry asked for", updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
    return c.json(await runQueueNow(db, c.env, userId, []));
  })

  // Leave a failed job or a saved change alone for good (written in History).
  .post("/:id/discard", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [job] = await db
      .delete(jobs)
      .where(and(eq(jobs.id, c.req.param("id")), eq(jobs.userId, userId), inArray(jobs.status, ["failed", "check"])))
      .returning();
    if (!job) throw new HTTPException(404, { message: "Nothing to discard" });
    await db.insert(events).values({
      userId,
      entityType: "sync",
      action: "queue.discarded",
      summary: `Discarded from the queue: ${job.title || job.kind}`,
      detail: { kind: job.kind, request: requestOf(job.payload), note: job.note.slice(0, 300) },
    });
    return c.json({ ok: true });
  });
