# WorkDesk

Single-user Gmail → task dashboard. React + Vite + Tailwind v4 (src/client), Hono API (src/server) that runs both as a Cloudflare Worker (Neon via drizzle neon-http) and locally on Node (PGlite in .data when DATABASE_URL is unset; demo user when GOOGLE_CLIENT_ID is unset). See README.md.

## Committed work is settled
- Once a function, feature, behaviour or design decision has been committed, do not delete or change it unless the user specifically asks to revise or change that item. Check `git log` / `git diff` to see what is committed.
- New requests are built alongside existing work, not by reworking it. If a request seems to need a committed item changed or removed (including bug fixes, refactors, renames, or "improvements" noticed in passing), stop and ask the user first, naming the item and the proposed change.
- Approval covers only the item the user named; it does not extend to related code.

## Non-negotiable
- Gmail is read-only except for user-approved changes (2026-10-06): (1) opening an email in the viewer marks that conversation read (`markThreadRead`, removes UNREAD only); (2) the user's own labels (`Label_…` IDs) can be created/renamed/recoloured/deleted and added/removed on a conversation, all through `gmailWrite` and its `WRITE_ROUTES`. System labels (INBOX/TRASH/SPAM/UNREAD/…) must never be passable to the label tools. Never add any other Gmail write (trash/delete emails/archive/send/drafts/filters/batchModify) or broader scopes than `gmail.modify`. `tests/gmail-safety.test.ts` enforces this.
- Dismiss / complete / snooze change only WorkDesk's database, and every such action writes an `events` row (audit trail).

## Touch first (always)
- Every UI change must work well by touch. Tappable controls need a hit area of at least 44×44px: the base CSS in `src/client/styles.css` gives every `button`, `a[href]` and `[role="tab"]` an invisible 44px hit area (opt out with `no-tap`). Rely on that invisible area, not on bigger visuals.
- Keep phones compact and information-dense (user feedback 2026-10-06: the enlarged mobile UI showed too little). Visible controls stay small; touch devices get at most a modest bump (`h-8 … pointer-coarse:h-9`). On phones use tight padding (`px-3`), one-row sideways-scrolling tabs (`no-scrollbar`), short labels, and hide descriptive text (page subtitles) rather than wrapping. Home on phones shows the stats as one row of four and one panel at a time via the Today / To-do / Emails switcher. The Today panel on phones has no tabs (user request 2026-10-06): one list, overdue first then today; its refresh sits at the end of the switcher row and New task is a floating + button.
- Phones (under 768px) render everything at 90% (user feedback 2026-10-06, "more information on screen"): `styles.css` sets the root font size to 90% and zooms Lucide icons to 0.9. Write text sizes in rem (`text-[0.8125rem]`, not `text-[13px]`) so they scale; tap areas and 16px form text stay in px on purpose.
- Leave at least 8px between neighbouring tap targets on touch; never put an action or needed information only behind hover (tooltips are extras); give pressed feedback (base `:active` style); keep form text 16px on touch (base CSS) so iOS doesn't zoom.
- Phones (touch screen under 768px, `useSwipeMode`) act on list rows by swiping, like mobile apps (user request 2026-10-06): wrap rows in `SwipeRow` (`src/client/components/SwipeRow.tsx`). Swipe right = main action (complete task / make task from email / restore), swipe left = the other actions as buttons. In that mode the row's own action buttons (check circle, ⋮ menu, Gmail link, email button bar) are hidden so text gets the full width. Mouse and tablet layouts keep their buttons. Swipe actions that remove a row offer Undo via `showUndo`.
- Check new screens on the phone preset (375px wide, touch emulation) as well as desktop.

## Interaction states (every clickable element)
- Base CSS gives everything clickable a hand pointer, disabled controls a not-allowed pointer, 150ms transitions, and turns motion off for `prefers-reduced-motion`.
- Each control also needs visible states: hover (mouse only; Tailwind `hover:` already skips touch), pressed (`active:scale-[0.97]` for buttons/tabs, `active:scale-90` for icon buttons), selected/current (`aria-selected`, `aria-current`, `aria-expanded:` styles), disabled (`disabled:opacity-50`; use `enabled:hover:` so disabled controls don't react).
- List rows highlight only while one of their controls is hovered (`has-[:is(button,a):hover]:bg-slate-50/80`), and a title turns blue only when the title itself, which opens the item, is hovered (`group/title`).

## Conventions
- Schema change: edit `src/server/db/schema.ts`, then `npm run db:generate` (commit the SQL in `drizzle/`).
- Neon HTTP driver: no interactive transactions; prefer bulk inserts/upserts. Keep Worker requests well under the subrequest limit (each DB query and Gmail call is one).
- Reports: a period's task and the period move together (completing/reopening either updates the other via `setPeriodStatus`). Period maths lives in `src/shared/reportSchedule.ts` with tests.
- Gmail sync fetches each message once: downloaded message IDs live in `gmail_messages`; new messages in stored conversations are fetched singly; read/unread comes from the history log without downloads. First sync covers the last 30 days, continued across runs. Covered by `tests/sync.test.ts`.
- Client data is a hybrid: TanStack Query cache persisted to localStorage (`src/client/queryClient.ts`, 5 min stale time); the database is the source of truth. Every screen and list has a `RefreshButton`. Per-request housekeeping on the server is throttled in `src/server/lib/maintenance.ts`.
- Version shown beside the title is computed from git at build time (`appVersion` in `vite.config.ts`): MAJOR from the latest `vN` tag (1 if none), MINOR = commits since it. Don't hard-code versions; a major update is the user tagging `vN`.
- Task/done labels (`users.taskLabelId/doneLabelId`, `src/server/lib/taskLabels.ts`): Gmail→WorkDesk `applyLabelRules` only creates or completes tasks (never reopens/deletes); WorkDesk→Gmail `reconcileThreadLabels` is best-effort and must never block task actions. Covered by `tests/task-labels.test.ts`.
- Calendar dates are `YYYY-MM-DD` strings in `APP_TIMEZONE` (default Asia/Kolkata).
- Before finishing: `npm run typecheck` and `npm test`.
