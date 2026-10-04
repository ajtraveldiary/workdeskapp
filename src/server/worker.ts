// Cloudflare Worker entry: the API under /api/*, the built dashboard for everything else,
// and the cron trigger for Gmail sync.
import { createApp } from "./app";
import { neonDb } from "./db/neon";
import type { Env } from "./env";
import { requireEnv } from "./env";
import { scheduledSync } from "./lib/sync";

const app = createApp({ getDb: (env) => neonDb(requireEnv(env, "DATABASE_URL")), allowDemo: false });

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledSync(neonDb(requireEnv(env, "DATABASE_URL")), env));
  },
} satisfies ExportedHandler<Env>;
