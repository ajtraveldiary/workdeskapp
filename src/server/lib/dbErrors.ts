// Database failures reported to the app in plain words (user request 2026-10-06: "show database error & check
// Neon usage limit popup when database pauses"). Neon's free plan stops the database when a monthly limit
// (compute hours, storage, data transfer) is used up; queries then fail with messages like "Your project has
// exceeded the compute time quota". Drizzle wraps driver errors ("Failed query: …" with the cause attached).

export type DbErrorCode = "database_paused" | "database_error";

const QUOTA = /quota|exceeded|size limit|limit .*exceeded|endpoint .*(disabled|suspended)|compute .*(suspended|disabled)|upgrade your plan/i;
// Only clear database signs: a bare "fetch failed" may just as well be a Gmail call.
const DATABASE = /neon|postgres|failed query|could not connect to (the )?(server|database|compute)|couldn't connect to compute|terminating connection|database (system|is|does)/i;

function messages(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; i++) {
    const x = e as { name?: string; message?: string; cause?: unknown };
    parts.push(`${x.name ?? ""}: ${x.message ?? String(e)}`);
    e = x.cause;
  }
  return parts.join(" | ");
}

// null: not a database problem (the usual 500 handling applies).
export function classifyDbError(err: unknown): { code: DbErrorCode; detail: string } | null {
  const text = messages(err);
  const named = /NeonDbError|DrizzleQueryError|DatabaseError|PGlite/i.test(text);
  if (!named && !DATABASE.test(text)) return null;
  // The original driver message, without the SQL drizzle puts in front of it.
  const detail = text.replace(/Failed query:[\s\S]*?(params:[^|]*)?\|/i, "").replace(/\s+/g, " ").trim().slice(0, 300);
  return { code: QUOTA.test(text) ? "database_paused" : "database_error", detail };
}

export const DB_ERROR_MESSAGE: Record<DbErrorCode, string> = {
  database_paused: "WorkDesk's database is paused: a Neon free-plan usage limit has probably been reached.",
  database_error: "WorkDesk couldn't reach its database (Neon).",
};
