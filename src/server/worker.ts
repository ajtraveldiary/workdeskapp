// Cloudflare Worker entry: the API under /api/*, the built dashboard for everything else,
// and the cron trigger that runs the background queue (Gmail sync, phone notifications, labels, upkeep).
import { createApp } from "./app";
import { neonDb } from "./db/neon";
import type { Env } from "./env";
import { requireEnv } from "./env";
import { callLimit, installCallCounter, newBudget, withCalls } from "./lib/callBudget";
import { runScheduledQueue } from "./lib/queue";

// Every outgoing call is counted against the run's budget (user request 2026-10-23, "Too many subrequests").
installCallCounter();

const app = createApp({ getDb: (env) => neonDb(requireEnv(env, "DATABASE_URL")), allowDemo: false });

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = neonDb(requireEnv(env, "DATABASE_URL"));
    // Notifications run first in the queue, so they still go out when the sync fails or pauses.
    ctx.waitUntil(withCalls(newBudget(callLimit(env)), () => runScheduledQueue(db, env)));
  },
} satisfies ExportedHandler<Env>;
