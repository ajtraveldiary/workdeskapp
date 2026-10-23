export type Env = {
  DATABASE_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OWNER_EMAIL?: string;
  APP_URL?: string;
  SESSION_SECRET?: string;
  TOKEN_ENC_KEY?: string;
  APP_TIMEZONE?: string;
  // Max Gmail threads fetched per sync run (keeps each run under Workers subrequest limits).
  SYNC_BATCH?: string;
  // How far back the first sync looks.
  SYNC_INITIAL_DAYS?: string;
  // Outgoing calls (database queries, Gmail requests, pushes) one Worker run may make: 50 on Cloudflare's free
  // plan. The queue stops work before it and carries on in the next run (lib/queue.ts). Unset = no limit.
  SUBREQUEST_LIMIT?: string;
};

export const timezone = (env: Env) => env.APP_TIMEZONE || "Asia/Kolkata";

export function requireEnv<K extends keyof Env>(env: Env, key: K): string {
  const v = env[key];
  if (!v) throw new Error(`Missing configuration: ${key}`);
  return v;
}
