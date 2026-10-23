// Settings › Queue (user request 2026-10-23): the background queue's jobs, Run now and Retry. Runs started here use
// the request's own calls budget (SUBREQUEST_LIMIT), like the cron's.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../app";
import { jobs } from "../db/schema";
import type { Env } from "../env";
import type { DB } from "../db";
import { callLimit, newBudget, withCalls } from "../lib/callBudget";
import { runQueue } from "../lib/queue";
import type { JobKind } from "../../shared/jobs";
import type { QueueInfo } from "../../shared/types";

// The newest finished jobs shown beside everything still waiting.
const SHOWN = 60;

export const runQueueNow = (db: DB, env: Env, userId: string, kinds?: readonly JobKind[]) =>
  withCalls(newBudget(callLimit(env)), () => runQueue(db, env, userId, "app", kinds));

export const queueRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.get("db").select().from(jobs).where(eq(jobs.userId, c.get("userId"))).orderBy(desc(jobs.updatedAt)).limit(SHOWN);
    const limit = callLimit(c.env);
    return c.json({ limit: Number.isFinite(limit) ? limit : null, jobs: rows } as unknown as QueueInfo);
  })

  .post("/run", async (c) => c.json(await runQueueNow(c.get("db"), c.env, c.get("userId"))))

  // A failed job: queued again from the start (if one of its kind is already waiting, that one covers it).
  .post("/:id/retry", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [job] = await db
      .delete(jobs)
      .where(and(eq(jobs.id, c.req.param("id")), eq(jobs.userId, userId), eq(jobs.status, "failed")))
      .returning();
    if (!job) throw new HTTPException(404, { message: "No failed job to retry" });
    return c.json(await runQueueNow(db, c.env, userId, [job.kind]));
  });
