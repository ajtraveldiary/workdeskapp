# WorkDesk

Single-user Gmail → task dashboard. React + Vite + Tailwind v4 (src/client), Hono API (src/server) that runs both as a Cloudflare Worker (Neon via drizzle neon-http) and locally on Node (PGlite in .data when DATABASE_URL is unset; demo user when GOOGLE_CLIENT_ID is unset). See README.md.

## Non-negotiable
- Gmail is read-only. Never add Gmail write calls (trash/delete/modify/labels/send/drafts) or broader scopes. `src/server/lib/gmail.ts` only does GET to `READ_PATHS`; `tests/gmail-safety.test.ts` enforces this.
- Dismiss / complete / snooze change only WorkDesk's database, and every such action writes an `events` row (audit trail).

## Conventions
- Schema change: edit `src/server/db/schema.ts`, then `npm run db:generate` (commit the SQL in `drizzle/`).
- Neon HTTP driver: no interactive transactions; prefer bulk inserts/upserts. Keep Worker requests well under the subrequest limit (each DB query and Gmail call is one).
- Calendar dates are `YYYY-MM-DD` strings in `APP_TIMEZONE` (default Asia/Kolkata).
- Before finishing: `npm run typecheck` and `npm test`.
