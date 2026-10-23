// Local development API server (Node). Uses Neon if DATABASE_URL is set, otherwise a local
// database in ./.data. Without Google credentials it signs you in as a demo user.
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import type { DB } from "./db";
import { localDb } from "./db/local";
import { neonDb } from "./db/neon";
import type { Env } from "./env";
import { callLimit, installCallCounter, newBudget, withCalls } from "./lib/callBudget";
import { runScheduledQueue } from "./lib/queue";

const env = process.env as Env;
// Counted as in production; without SUBREQUEST_LIMIT in .env there is no limit here.
installCallCounter();
const db: DB = env.DATABASE_URL ? neonDb(env.DATABASE_URL) : await localDb();
const app = createApp({ getDb: () => db, allowDemo: true });

serve({ fetch: (req) => app.fetch(req, env), port: 8787 }, () => {
  console.log(`WorkDesk API on http://localhost:8787 (${env.DATABASE_URL ? "Neon" : "local database"}, ${env.GOOGLE_CLIENT_ID ? "Google sign-in" : "demo mode"})`);
});

// Same schedule as production's cron trigger: the background queue (notifications, Gmail sync when Google is
// set up, labels, upkeep).
setInterval(() => void withCalls(newBudget(callLimit(env)), () => runScheduledQueue(db, env)).catch((e) => console.error("Queue run failed:", e)), 10 * 60_000);
