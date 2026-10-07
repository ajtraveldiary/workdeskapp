// Cloudflare Worker entry: the API under /api/*, the built dashboard for everything else,
// and the cron trigger for Gmail sync and phone notifications.
import { createApp } from "./app";
import { neonDb } from "./db/neon";
import type { Env } from "./env";
import { requireEnv } from "./env";
import { scheduledSync } from "./lib/sync";
import { sendScheduledPush } from "./lib/notify";

const app = createApp({ getDb: (env) => neonDb(requireEnv(env, "DATABASE_URL")), allowDemo: false });

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = neonDb(requireEnv(env, "DATABASE_URL"));
    ctx.waitUntil(
      (async () => {
        try {
          await scheduledSync(db, env);
        } finally {
          // Phone notifications (user request 2026-10-07) go out even when the sync failed.
          await sendScheduledPush(db, env);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
