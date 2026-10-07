// Local development API server (Node). Uses Neon if DATABASE_URL is set, otherwise a local
// database in ./.data. Without Google credentials it signs you in as a demo user.
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import type { DB } from "./db";
import { localDb } from "./db/local";
import { neonDb } from "./db/neon";
import type { Env } from "./env";
import { scheduledSync } from "./lib/sync";
import { sendScheduledPush } from "./lib/notify";

const env = process.env as Env;
const db: DB = env.DATABASE_URL ? neonDb(env.DATABASE_URL) : await localDb();
const app = createApp({ getDb: () => db, allowDemo: true });

serve({ fetch: (req) => app.fetch(req, env), port: 8787 }, () => {
  console.log(`WorkDesk API on http://localhost:8787 (${env.DATABASE_URL ? "Neon" : "local database"}, ${env.GOOGLE_CLIENT_ID ? "Google sign-in" : "demo mode"})`);
});

// Same schedule as production's cron trigger.
// Phone notifications, as the production cron does after each sync.
setInterval(() => sendScheduledPush(db, env).catch((e) => console.error("Notifications failed:", e)), 10 * 60_000);
if (env.GOOGLE_CLIENT_ID) {
  setInterval(() => scheduledSync(db, env).catch((e) => console.error("Sync failed:", e)), 10 * 60_000);
}
