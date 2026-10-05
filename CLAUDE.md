# WorkDesk

Single-user Gmail → task dashboard. React + Vite + Tailwind v4 (src/client), Hono API (src/server) that runs both as a Cloudflare Worker (Neon via drizzle neon-http) and locally on Node (PGlite in .data when DATABASE_URL is unset; demo user when GOOGLE_CLIENT_ID is unset). See README.md.

## Committed work is settled
- Once a function, feature, behaviour or design decision has been committed, do not delete or change it unless the user specifically asks to revise or change that item. Check `git log` / `git diff` to see what is committed.
- New requests are built alongside existing work, not by reworking it. If a request seems to need a committed item changed or removed (including bug fixes, refactors, renames, or "improvements" noticed in passing), stop and ask the user first, naming the item and the proposed change.
- Approval covers only the item the user named; it does not extend to related code.

## Non-negotiable
- Gmail is read-only with one user-approved exception (2026-10-06): opening an email in the viewer marks that conversation read (`markThreadRead`, removes UNREAD only). Never add any other Gmail write (trash/delete/archive/labels/send/drafts/batchModify) or broader scopes than `gmail.modify`. `src/server/lib/gmail.ts` otherwise only does GET to `READ_PATHS`; `tests/gmail-safety.test.ts` enforces this.
- Dismiss / complete / snooze change only WorkDesk's database, and every such action writes an `events` row (audit trail).

## Touch first (always)
- Every UI change must work well by touch. Tappable controls need a hit area of at least 44×44px: the base CSS in `src/client/styles.css` gives every `button`, `a[href]` and `[role="tab"]` an invisible 44px hit area (opt out with `no-tap`). Rely on that invisible area, not on bigger visuals.
- Keep phones compact and information-dense (user feedback 2026-10-06: the enlarged mobile UI showed too little). Visible controls stay small; touch devices get at most a modest bump (`h-8 … pointer-coarse:h-9`). On phones use tight padding (`px-3`), one-row sideways-scrolling tabs (`no-scrollbar`), short labels, and hide descriptive text (page subtitles) rather than wrapping. Home on phones shows the stats as one row of four and one panel at a time via the Today / To-do / Emails switcher.
- Leave at least 8px between neighbouring tap targets on touch; never put an action or needed information only behind hover (tooltips are extras); give pressed feedback (base `:active` style); keep form text 16px on touch (base CSS) so iOS doesn't zoom.
- Check new screens on the phone preset (375px wide, touch emulation) as well as desktop.

## Conventions
- Schema change: edit `src/server/db/schema.ts`, then `npm run db:generate` (commit the SQL in `drizzle/`).
- Neon HTTP driver: no interactive transactions; prefer bulk inserts/upserts. Keep Worker requests well under the subrequest limit (each DB query and Gmail call is one).
- Reports: a period's task and the period move together (completing/reopening either updates the other via `setPeriodStatus`). Period maths lives in `src/shared/reportSchedule.ts` with tests.
- Gmail sync fetches each message once: downloaded message IDs live in `gmail_messages`; new messages in stored conversations are fetched singly; read/unread comes from the history log without downloads. First sync covers the last 30 days, continued across runs. Covered by `tests/sync.test.ts`.
- Client data is a hybrid: TanStack Query cache persisted to localStorage (`src/client/queryClient.ts`, 5 min stale time); the database is the source of truth. Every screen and list has a `RefreshButton`. Per-request housekeeping on the server is throttled in `src/server/lib/maintenance.ts`.
- Calendar dates are `YYYY-MM-DD` strings in `APP_TIMEZONE` (default Asia/Kolkata).
- Before finishing: `npm run typecheck` and `npm test`.
