# WorkDesk files

Every file in the project and what it does, folder by folder. When a file is added, removed, renamed or
changes what it does, update its line here in the same commit (see CLAUDE.md).

How the parts connect:

```
Browser (src/client)  ──/api/*──▶  Hono API (src/server/app.ts + routes/)  ──▶  Database (Neon / PGlite)
      │                                   │
      │ service worker (src/sw)           └──▶  Gmail API (lib/gmail.ts, read + approved label/mark-read only)
      └─ shared rules and types (src/shared), used by both sides
Cron every 10 min (src/server/worker.ts): the background queue (lib/queue.ts): phone notifications, Gmail sync, task labels, upkeep
```

## Project root

| File | What it does |
|---|---|
| `README.md` | For newcomers: who WorkDesk is for (HR staff, government establishment sections), every feature in a line, privacy, how to run it, connect Gmail and deploy. No personal details. |
| `CLAUDE.md` | Rules for working on the code: Gmail safety, touch-first design, and every feature decision the user made. |
| `AGENTS.md` | Short pointer for other AI coding agents: the rules are in CLAUDE.md. |
| `docs/FILES.md` | This file: every file and its job. |
| `docs/MCP_PLAN.md` | Plan for a WorkDesk MCP server (all five phases built 2026-10-18 / 19, with later additions): assistants (ChatGPT, Gemini), the user's data decisions, tools by phase, sign-in, the separate assistant log, safety limits, testing. |
| `docs/SEATS_PLAN.md` | Plan for managing an additional charge of a seat (not built yet): the user's decisions (Gmail label per seat, choose per item at handover, one seat switch at the top), seats on records, the seat's emails, taking over and handing over, assistants and letters. |
| `docs/LEAVE_PLAN.md` | Plan for employees' leave (all four phases built 2026-10-30: types, accounts, credits by hand and automatic, gazetted / probation switches, marking leave with its task, balances CSV, backup): the user's decisions (permanent staff, leave account with yearly credits on the service anniversary, EL from duty for probation-declared staff, gazetted / non-gazetted task steps due on rejoining), leave types, the account lines, marking / editing / cancelling a leave, screens, data and routes, chosen extras (EOL moves increment, EL surrender, gazetted from designation), open questions, phases. |
| `package.json` / `package-lock.json` | Libraries (unpdf reads PDF text for assistants) and the npm commands (`dev`, `test`, `typecheck`, `db:generate`, `db:migrate`, `deploy`); `allowScripts` approves install scripts per exact version (esbuild, workerd). |
| `tsconfig.json` | TypeScript settings for the whole project. |
| `vite.config.ts` | Builds the app: the version number from git (`appVersion`), `dist/version.json` for auto-update, and the service worker (`dist/sw.js`). Runs the dev server on :5173, passing `/api` and `/.well-known` to :8787. |
| `vitest.config.ts` | Test runner settings: at most 8 files at once, longer time limits for each file's database setup and each test. |
| `drizzle.config.ts` | Where the database schema and migrations live, for `npm run db:generate`. |
| `wrangler.jsonc` | Cloudflare Worker settings: entry file, the built app as static files (the Worker answers `/api/*` and `/.well-known/*` first), the 10-minute cron, the time zone, the sync batch (`SYNC_BATCH` 10, under the free plan's 50 subrequests); lists the secrets to set. |
| `.env.example` | The settings to copy into `.env` to use real Gmail locally (Google client, owner email, secrets, database). |
| `.gitignore` | Files git ignores (`node_modules`, `dist`, `.data`, `.env`…). |
| `.github/workflows/deploy.yml` | On every push to `master`: typecheck, tests, database migrations on Neon, build, deploy the Worker. |
| `.claude/launch.json` | How Claude Code starts the app for previews (`npm run dev` on port 5173). |

## `drizzle/` — database migrations

Each file changes the database once, in order; `npm run db:migrate` (and the deploy) applies new ones.
`drizzle/meta/` holds drizzle-kit's snapshots of the schema after each migration (generated; not edited by hand).

| File | What it does |
|---|---|
| `0000_init.sql` | First tables: users, Gmail accounts, emails (`email_threads`), tasks, categories, History (`events`). |
| `0001_profile.sql` | User's name and profile picture. |
| `0002_due_time.sql` | Optional time on a task. |
| `0003_reports.sql` | Recurring reports and their periods (later turned into reminders). |
| `0004_fetch_once.sql` | `gmail_messages`: remembers downloaded messages so each is fetched once. |
| `0005_granted_scopes.sql` | Records which Gmail permissions were granted. |
| `0006_muted_senders.sql` | Senders hidden from Pending. |
| `0007_gmail_labels.sql` | Copy of the user's Gmail labels and each email's labels. |
| `0008_labels_backfill.sql` | Progress marker for bringing in labels of older emails. |
| `0009_task_labels.sql` | The chosen task label and done label. |
| `0010_woozy_gideon.sql` | Removes categories (merged into Gmail labels). |
| `0011_equal_martin_li.sql` | Labels on tasks and reports without an email. |
| `0012_reminders.sql` | Reports become reminders (date, time, repeat, end, remind me); converts old reports. |
| `0013_auto_done_labels.sql` | "Straight to completed" labels (later replaced by sections; column kept, emptied). |
| `0014_hidden_snippets.sql` | Hidden text (signatures, disclaimers). |
| `0015_calendar_link.sql` | Private calendar link token. |
| `0016_task_checklist.sql` | Checklist steps inside a task. |
| `0017_reminder_links.sql` | Links (Google Drive, Sheets, Docs…) on a reminder. |
| `0018_task_waiting.sql` | Waiting for a reply: since when, and the reply-by date. |
| `0019_office_sections.sql` | Sections of the office: an email's section label, labels only for organising; empties the old auto-done list. |
| `0020_phone_notifications.sql` | Devices with notifications on, notification settings, push keys. |
| `0021_office_staff.sql` | Designations and employees; tasks/reminders can be about an employee, designation or the office. |
| `0022_file_register.sql` | File register (physical files and e-files). |
| `0023_employee_kinds.sql` | Permanent or temporary employees, contract end date. |
| `0024_temporary_employee_details.sql` | Types of temporary employees (HMC, NHM…), engaged as, contract days, pay per day. |
| `0025_pension_tasks.sql` | Remembers the Pension papers task made for an employee retiring within 12 months. |
| `0026_tasks_made_by_system.sql` | Marks tasks WorkDesk makes itself ("Made by system"), including Pension papers tasks already made. |
| `0027_contract_tasks.sql` | Kind of system task (pension / contract) and the Contract ends task kept for each temporary employee. |
| `0028_probation_tasks.sql` | Remembers the Probation declaration task made for an employee. |
| `0029_basic_pay.sql` | Basic pay (₹) for permanent employees, separate from the pay scale. |
| `0030_site_logins.sql` | Saved website logins (SPARK, BiMS…): website, link, employee or role, user ID, encrypted password, remarks. |
| `0032_file_tags.sql` | Tags on File register entries (`tag_ids` on `office_files`). |
| `0033_office_events.sql` | Events (meetings, trainings, programmes): the `office_events` table, the email state "event", and `event_id` / `event_date` on tasks for preparation tasks. |
| `0035_user_employee.sql` | Which employee the user is (`employee_id` on `users`; forgotten if that employee is deleted). |
| `0036_employee_moves.sql` | Joining and relieving: `employee_moves` (employee, join or relieve, date, its task; removed with the task or the employee). |
| `0037_registers.sql` | Registers (`registers`: name, order, date updated until) and their pending entries (`register_entries`: text, the employee needed, done, the task when it has a due date). |
| `0038_linked_emails.sql` | More emails on a task or an event (`linked_emails`: the email and its task or event). |
| `0039_assistant_connection.sql` | Assistants (MCP): `mcp_clients`, `mcp_codes`, `mcp_tokens` and `assistant_log`. |
| `0040_assistant_changes.sql` | Assistant changes (MCP Phase 3): `users.assistant_changes` (Allow changes) and `assistant_per_hour`, and `assistant_log.change` / `touched`. |
| `0041_assistant_staff.sql` | Assistant staff actions (MCP Phase 4): `users.assistant_staff` (Allow staff actions). |
| `0042_assistant_seen.sql` | The assistant bell (MCP Phase 5): `users.assistant_seen_at`, when the user last looked at the assistant's changes. |
| `0043_office_profile.sql` | Office details (`office_profiles`: one row per user, the details as JSON). |
| `0044_task_links.sql` | Links on tasks (`tasks.links`, like reminders' links). |
| `0045_background_queue.sql` | The background queue (`jobs`: kind, status, tries, pauses, next try, calls used, note; one waiting or running job per kind). |
| `0046_call_log.sql` | Calls log (`call_logs`: one row per request or 10-minute run with every outgoing call) and saved changes / refused notifications on `jobs` (`payload`, `title`, `call_log_id`; the one-per-kind index only for the four background kinds). |
| `0047_leave.sql` | Leave (phase 1): `leave_types` (balance of its own / takes from another type, days per day, may go below zero, most kept, service limit, medical, yearly credit), `leave_ledger` (an employee's leave account lines, one credit per year and type), `employees.gazetted`, `employees.probation_declared` (yes for a declared date or 2 years of service done over 2 years ago) and `designations.gazetted`. |
| `0048_employee_leaves.sql` | Leaves marked (`employee_leaves`: type, dates, days, order, notes, rejoined on, active / cancelled, extension of, task) and `leave_ledger.leave_id`. |
| `0049_leave_auto_credits.sql` | `leave_types.credits_from`: automatic yearly credits from that date (null = by hand only). |
| `0050_leave_delays_increment.sql` | `leave_types.delays_increment` (doesn't count for increment or probation), set for existing EOL types. |
| `0051_ksr_leave_types.sql` | Built-in KSR leave types: `leave_types.ksr_key` (unique per account), `rule`, `active` and the limits (`at_once`, `non_medical_at_once`, `non_medical_limit`, `spell_limit`, `last_resort`, `surrender_per_year`, `terminal_surrender`); `employee_leaves.on_medical`; `leave_ledger.terminal`. Existing usual types of the same name become the KSR ones. |
| `0052_employee_off_day.sql` | `employees.off_day` (Sunday off / weekly off; every employee, default Sunday off). |
| `0034_event_types.sql` | The user's own event types (`event_types`; every account gets Meeting, Training, Programme) and `type_id` on events, filled from the old fixed kind ("Other" = no type). |
| `0031_tags.sql` | Tags for tasks and reminders: the `tags` table (name unique per user whatever its capitals, colour, order) and `tag_ids` on tasks and reminders. |

## `src/server/` — the API (Cloudflare Worker, or Node when run locally)

| File | What it does |
|---|---|
| `app.ts` | Builds the Hono API: Google sign-in (`/api/auth/google`, which can return to an assistant's consent page), sign-out, session cookie, demo sign-in when Google isn't set up, database-error answers, the assistants' sign-in details at `/.well-known/`, `/api/oauth` and `/api/mcp` (before the sign-in check), and mounts every route file below.; first of all, every request runs in a calls budget and its calls are logged as one row, and a change that fails with a server error is saved to the queue (503 `saved_for_retry` / `needs_check`); hands the queue the `replay` that does saved changes again as their user. |
| `worker.ts` | Cloudflare entry: serves `/api/*`, the built app for everything else, and the 10-minute cron, which runs the background queue within the run's calls budget; turns on the calls counter. |
| `dev.ts` | Local entry (Node, port 8787): Neon if `DATABASE_URL` is set, otherwise the local database; runs the background queue every 10 minutes (no calls limit unless `SUBREQUEST_LIMIT` is set). |
| `env.ts` | The Worker's settings and secrets (`Env`), the app time zone, and a helper that fails clearly when a secret is missing. |

### `src/server/mcp/` — the MCP server for assistants (ChatGPT, Gemini)

| File | What it does |
|---|---|
| `oauth.ts` | Sign-in for assistants: the discovery documents, client registration (and client metadata documents, read without following redirects, with the reason shown when they can't be read), the consent page (`/api/oauth/authorize`, after Google sign-in), codes with PKCE, access and refresh tokens (stored hashed, refresh replaced on use), revocation, the bearer check, and clearing expired codes, tokens and old log rows. |
| `server.ts` | The MCP endpoint (`POST /api/mcp`, JSON-RPC over HTTP): 401 with the sign-in address without a token; `initialize` (with instructions about WorkDesk and whether changes are allowed), `prompts/list` / `prompts/get` (prompts.ts), `tools/list` (`ALL_TOOLS`: read, change and staff tools), `tools/call` (each call written to the assistant log); change tools only while Allow changes is on (staff actions also need Allow staff actions) and under the hourly limit, their History entries marked "(via <assistant>)"; tools work through the app's own routes as the user. |
| `tools.ts` | The 20 read-only tools and how their answers are organised: names instead of ids, words instead of codes, empty fields left out, notes on what things mean; never website passwords.; Settings includes the office details for letters. |
| `changes.ts` | The change tools (Phase 3): create / change / complete / reopen tasks, make a task from an email, add emails to or take them off a task or event, remove emails or send them to a section, add / change / tick register entries, create events and change one date of an event, create / change / pause reminders and mark their dates, add and change file register entries. Names (employees, designations, tags, registers, sections, event types) are turned into ids, and an unclear name comes back as a question; at most 10 items a call; nothing is deleted. |
| `staff.ts` | The staff actions (Phase 4): join and relieve employees with the steps already done, set a joining / relieving step, mark an increment done with the new basic pay, renew or end a contract, declare probation, mark a register updated, add an employee and change an employee's details (the whole employee form filled from what is there plus the changes; a temporary contract's end worked out from joining + days). Employees, steps, designations and types by name; unclear names answered with the choices. |
| `leave.ts` | Leave for assistants: `get_leave_account` (read: balances, used against limits, leaves with state and steps, latest account lines, each leave's KSR rule and limits) and `mark_leave` (a staff action, as Mark leave; on a medical certificate or not; EOL not on one also moves increment / probation; answers the KSR limits crossed). |
| `prompts.ts` | Ready-made prompts (Phase 5): Morning briefing, Reply to this email (an official letter draft in English or Malayalam; never sent), Employee status, Monthly work diary, Pending email triage (applies what the user approves), Month-end returns check, Weekly review, Staff matters this month — each the instructions for which tools to use and what to write.; the same instructions as the read-only tool `use_prompt` (`PROMPT_TOOL`), for assistants that only use tools (ChatGPT, the Gemini app). |
| `content.ts` | Email HTML to plain text, and attachments to text: PDF (unpdf; scanned PDFs passed on as the file), Excel / ODS / CSV, Word .docx, PowerPoint .pptx, plain text; pictures as images. |

### `src/server/db/`

| File | What it does |
|---|---|
| `schema.ts` | Every database table and column (Drizzle): users, Gmail accounts/messages/labels, hidden senders, hidden text, emails, tasks (with their links), saved website logins (`site_logins`), tags (`tags`), events (`office_events`) and their types (`event_types`), reminders (`reports`) and their dates (`report_periods`), designations, employee types, employees, file register, push devices, History (`events`), and for assistants: their apps (`mcp_clients`), sign-in codes and tokens (`mcp_codes`, `mcp_tokens`, stored hashed) and the assistant log (`assistant_log`); office details (`office_profiles`). |
| `index.ts` | The `DB` type both database drivers share. |
| `neon.ts` | Connects to Neon over HTTP (production). |
| `local.ts` | Local database with PGlite in `./.data` (no install needed); applies new migrations when it starts. |
| `migrate.ts` | `npm run db:migrate`: applies `drizzle/` to Neon or the local database. |

### `src/server/routes/` — API endpoints (all under `/api`)

| File | What it does |
|---|---|
| `threads.ts` | Emails: lists by state, one email, its content and attachments from Gmail (a file labelled as generic data is served by its name's type, `realMime`), mark read, make a task, Remove / Restore (single and bulk), mark a new reply seen. |
| `tasks.ts` | Tasks: lists by view (today, overdue, upcoming, waiting, completed…), date ranges for the calendar, create, edit, complete, reopen, bulk delete (with Gmail task-label clean-up). |
| `reports.ts` | Reminders (stored as reports): list with their dates, create, edit, pause/resume, delete, mark a date done or not done. |
| `labels.ts` | Gmail labels: list, create, rename/recolour, delete, change an email's labels, task/done label settings, Send to a section (`/threads/bulk-section`). |
| `misc.ts` | `/me` (with which employee you are; set by `PUT /me/employee`), Home summary counts (with increments), History, hidden senders, hidden text, housekeeping (`/maintain`) and Sync now (through the background queue: a sync and labels job). |
| `staff.ts` | Employees page: designations and types of temporary employees (order saved after drag and drop), employees (add/edit, left the office, delete), an employee's open work, increment done, contract renewed / ended (with Undo; both complete the Contract ends task), probation declared (with Undo; completes the Probation declaration task), retiring within 12 months (`/retiring`, with each one's Pension papers task); an employee's page (`/employees/:id/profile`: tasks open and completed, reminders, History); adding or editing an employee makes their Pension papers task when due. `employeeValues` keeps only the fields that fit permanent or temporary staff. Gazetted post tick (`/designations/:id/gazetted`, its employees follow); the Probation declared and Gazetted switches kept when a form leaves them out (`withSwitches`). |
| `leave.ts` | Leave (`/leave`): leave types (list with use counts, add, add the usual Kerala leaves, change, arrange, remove when unused), Credit now (a year's credit to every permanent employee in the office, preview first, once per year, the extra above the most kept lapses), an employee's leave account (balances and lines) and adding an opening balance / credit / adjustment; History for each. Phase 2: leaves (`/leave/leaves`: one employee's, every one with `?all=1` for the Leave page, or the ones that matter now, mark with its account line and task, edit / rejoin with days given back and taken again, cancel; no two leaves of one employee on a day). Phase 4: EOL moves the next increment and the open Probation declaration task by its days when asked (`postpone`), with `/leaves/:id/postpone/undo`; surrender of earned leave (`/accounts/:employeeId/surrender`: a surrender line and a task with the surrender steps). KSR types: built in on the first read of the list, `/types/:id/reset` (back to the KSR figures), never removed, switched off ones refused by Mark leave; leaves keep On a medical certificate (EOL on one moves nothing); the account's `used` has `nonMedical`; terminal surrender. |
| `files.ts` | File register: list, add, edit, remove (with tags); one entry per e-file number. |
| `logins.ts` | Saved website logins: list (never with passwords), add, edit, remove, and reveal one password for Show / Copy (noted in History). Passwords encrypted with `TOKEN_ENC_KEY`. |
| `tags.ts` | Tags for tasks and reminders: list (with how many use each), make or reuse by name, rename / recolour, delete (taken off everything), reorder. |
| `officeEvents.ts` | Events (`/office-events`): list, add (also from an email, which leaves Pending or becomes the preparation task's email), edit, delete (open preparation tasks go, the email returns to Pending), and one date marked done, moved, cancelled or put back. |
| `eventTypes.ts` | Event types (`/event-types`, Settings › Events): list with how many events have each, add, add Meeting/Training/Programme, rename, arrange, delete (its events stay, without a type). |
| `moves.ts` | Joining and relieving (`/moves`): the summary list with each step's state, join or relieve someone (back in the office / Left the office on the date, and the task), set one step from the table. |
| `registers.ts` | Registers (`/registers`: list with counts, add, rename / updated until, Updated (today + clear done entries), arrange, remove with their entries) and their entries (`/register-entries`: list, add, change, done / pending, remove); an entry's due date makes, moves or removes its task. |
| `linkedEmails.ts` | More emails on a task or event (`/linked-emails`): list (main first), add Pending emails (they leave Pending, task labels in Gmail), take one off (back to Pending unless another open task has it). |
| `assistant.ts` | Settings › Assistant (`/assistant`): the address assistants connect to, Allow changes, the hourly limit and Allow staff actions (`PUT /assistant/settings`, History entry), connected assistants (Disconnect deletes their tokens, History entry) and the assistant log, 50 at a time (`?before=`, `?changes=1`).; the bell's unseen changes (`/assistant/unseen`, newest 5 and a count) and `/assistant/seen`; the log as CSV (`/assistant/log.csv`, `?changes=1`). |
| `officeProfile.ts` | Office details (`/office-profile`): read (with every field filled in) and save the whole form; each save in History. |
| `queue.ts` | Settings › Queue (`/queue`): the jobs (newest 60, saved bodies kept on the server) and the calls limit, Run now, Retry (failed jobs and changes waiting for a check), Discard (written in History), and the calls log (`/queue/calls`: failed only, the queue's own checks, older pages); `runQueueNow` runs the queue in the request's own budget (also used by Sync now). |
| `calendar.ts` | Private calendar link: make/replace/turn off the link, and the public `.ics` feed it serves. |
| `push.ts` | Phone notifications: turn on/off for a device, what to send and when, send a test. |
| `transfer.ts` | Import / Export: master backup download and import (adds only what's missing), CSV export and import (preview, then in parts) for file register, employees, tasks and reminders. Leave balances CSV (export as on today; import: opening balance first, then an adjustment to the balance given) and the leave tables in the backup (unused leave types of the same name make room). |

### `src/server/lib/` — the work behind the routes

| File | What it does |
|---|---|
| `gmail.ts` | The only code that talks to Gmail: read-only GETs from an allowlist, mark read, and the user's own labels. Enforced by `tests/gmail-safety.test.ts`.; `gmailPathOf` names Gmail calls for the calls log. |
| `gmailAuth.ts` | Gets a fresh Gmail access token from the stored (encrypted) refresh token. |
| `sync.ts` | Gmail sync: first 30 days, then Gmail's change log; each message downloaded once; labels kept up to date; cron sync for all users (also makes due reminder dates, Pension papers, Contract ends and Probation declaration tasks; no longer used by the cron, which runs the queue); downloads only as many emails as fit in a queue run's calls left. |
| `threadRules.ts` | What a new message does to an email that was removed, made a task, made an event, or sent to another section. |
| `taskLabels.ts` | Keeps the task/done Gmail labels and WorkDesk tasks in step both ways; catches up emails missing their label. |
| `sections.ts` | Sections of the office: moves emails with another section's label to "Other sections" and back. |
| `reports.ts` | Creates each reminder date and its task when it is due; marks a date and its task done together. |
| `emailContent.ts` | Reads an email's body and attachments from Gmail for the viewer (never stored); demo content. |
| `muted.ts` | Checks whether an email's sender is hidden from Pending. |
| `maintenance.ts` | Housekeeping on page loads, at most every few minutes: returns any old snoozed email to Pending, creates due reminder dates, applies section rules, makes Pension papers, Contract ends and Probation declaration tasks, and clears expired assistant sign-ins and assistant log rows older than a year. Also the automatic leave credits. |
| `ics.ts` | Builds the calendar file (`.ics`) for the calendar link (tasks, reminder dates, events with place and status), with Malayalam-safe line folding. |
| `notify.ts` | Decides which phone notifications are due (morning summary with today's events, due-time notes, an event's note 1 hour before, badge count) and sends them; `sendPushTo` is one user's, the queue's notify job, which stops before marking anything sent when the run's calls won't cover it.; a notification a push service refuses is saved as a `push` job; `pushKeys` signs pushes. |
| `webpush.ts` | Web Push with WebCrypto only: encrypts a message for a device and signs it (VAPID). |
| `queue.ts` | The background queue: puts in one job per background kind not already waiting, claims the due ones (saved changes and refused notifications too), runs them in order (notifications, refused notifications, saved changes, Gmail sync, task labels, upkeep) within the calls budget, marking their calls with the job; a job that doesn't fit or runs out of calls waits for the next run, a failure is tried again after 2, 4, 8, 16 minutes and then kept as failed (a saved change the app refuses fails at once); `action` jobs replay the request through the app, `push` jobs resend for up to 2 hours; upkeep clears done jobs and calls log rows after 2 days and failed ones after 30; `runScheduled` is the cron's run, logged as one row. |
| `callBudget.ts` | Counts every outgoing call (Neon queries, Gmail, Google sign-in, pushes) of a request or run against `SUBREQUEST_LIMIT`, refuses the next one before Cloudflare's limit (keeping a few for the queue's own writes), and records each call (`describeCall`: a query by verb and table only, Gmail by method and path, never the data) with its time, result and job. |
| `callLog.ts` | Writes a request's calls as one `call_logs` row from the reserve; saves a failed change as an `action` job (queued when nothing was saved before it failed, `check` when part was; never for passwords, sign-in, device keys, imports, the assistant endpoint or the queue's own buttons). |
| `staff.ts` | Checks what a task or reminder is "for" (employee, designation, office) and names it for History. |
| `tags.ts` | Tags: checks the tag ids a task or reminder is given, finds or makes tags by name (CSV import), tag names for export and search. |
| `officeEvents.ts` | Events: today's events for Home, and the preparation tasks (made up to 30 days ahead, moved with the event, dropped when it is cancelled or deleted). |
| `moves.ts` | Joining and relieving: makes the task with its steps (For the employee, made by the system, due 7 days after the date) and its row; completes the task when every step is done and reopens it when one is set back. |
| `checklist.ts` | When each step of a task last changed: `stampChecklist` sets `at` on steps whose done / waiting state changed (server time; what the app sends is ignored), used by the task, moves and leave routes. |
| `leave.ts` | Leave: a leave task completes itself when every step is done and reopens when one is set back (`settleLeaveTask`, called by the task routes). Phase 3: the automatic yearly credits on service anniversaries (`ensureLeaveCredits`, run by `maintain`: fixed days such as HPL 20, or EL as 1/11 of the days on duty less leave for probation-declared staff; once a year, never before the opening balance) and the lapse above the most kept (`lapseAbove`). The built-in KSR leave types (`ensureKsrLeaveTypes`, adopting an older type of the same name; `ksrValues`). |
| `registers.ts` | Registers: an entry and its task kept in step both ways (`entryFollowsTask` from the task routes, `taskFollowsEntry` from the entry's tick). |
| `linkedEmails.ts` | A task's emails, main and added (`tasksOfThreads`, `allTaskThreads`, `addedEmailsOfTasks`), used by the sync, the task/done labels, the email's status tags and deleting tasks. |
| `contracts.ts` | Makes the "Contract ends" task 7 days before a temporary contract ends (one per end date; moves it when the date is edited). |
| `probation.ts` | Makes the "Probation declaration" task 7 days before 2 years of service when probation isn't declared (recent joinings only); completes it when a declared date is entered. Probation declared "yes" without a date counts as declared too. |
| `pension.ts` | Makes the Pension papers task (with the pension checklist) 12 months before a permanent employee retires, once per employee. |
| `users.ts` | Creates the user on first sign-in; demo mailbox and demo reminders. |
| `audit.ts` | Writes a History (`events`) row. |
| `crypto.ts` | Signs the session cookie, encrypts refresh tokens and the push key (AES-GCM). |
| `dates.ts` | Today's date in the app time zone; adding days. |
| `dbErrors.ts` | Turns database failures (Neon paused by a usage limit, unreachable) into plain messages. |

## `src/shared/` — rules and types used by both the server and the browser

| File | What it does |
|---|---|
| `assistantHelp.ts` | The text of Settings › Assistant help: every MCP command and prompt in groups, with its kind (reads / needs Allow changes / needs Allow staff actions / prompt), hint, example and notes. |
| `types.ts` | The shapes of data the API sends to the app (Thread, Task, Report, Employee, OfficeFile, SiteLogin, Summary…). |
| `schemas.ts` | Checks on everything the app sends (Zod): tasks, reminders, tags, labels, staff, files, website logins, notifications, hidden text. |
| `reminderSchedule.ts` | Reminder date maths: repeats, next dates, "remind me" lead days, labels like "Every month". |
| `eventSchedule.ts` | Event maths: the starting event types and the "Event" label for none, each date of a repeating event in a range with its changes (done, moved, cancelled), time ranges. |
| `jobs.ts` | The background queue's kinds of work (the four background kinds plus saved changes and refused notifications; title, what it does, calls needed to start), statuses (with `check`), tries and retry waits, and plain names for requests (`requestTitle`). |
| `moves.ts` | Joining and relieving steps (ids, names, Done or Received), Pending / Waiting / Done, and how a step's state is read from and written to the task's checklist. |
| `leave.ts` | Leave: the kinds of account line (opening, credit, leave, cancel, adjustment, lapsed, surrendered) and their names, the built-in Kerala Service Rules leave types (`KSR_LEAVE_TYPES`: EL, HPL, commuted, LND, EOL, maternity, miscarriage, hysterectomy, paternity, adoption, special disability, hospital, with rule, explanation and limits), the KSR limit warnings (`leaveWarnings`, `spellDays`), the financial year, days written as 20 / 2.5. The leave steps (gazetted / non-gazetted), calendar days, the leave's last day and rejoining day, the task title. Phase 4: the surrender steps and task title, the days a leave moves dates by. |
| `tags.ts` | Tag rules shared by both sides: the colour palette, tidy names (same tag whatever the capitals), reading the CSV Tags column. |
| `staff.ts` | Employee lists and rules: categories, engaged as, common designations and types, contract end date, increment due dates, contracts ending (Contract ends task from 7 days before, its title, renewed end date), retiring within 12 months (a year before, Pension papers title and checklist), probation (2 years from joining, task title). |
| `transfer.ts` | Import / Export: CSV columns of each list, sample files, CSV writing, reading dates/times/priorities, backup tables. Employees have Probation declared and Gazetted (Yes / No). Leave balances columns (PEN, Name, Leave, Balance, As on); backup tables leaveTypes, employeeLeaves, leaveLedger. |
| `findDates.ts` | Finds a due date written in an email (Indian day-first formats) for a new task. |
| `addressLists.ts` | Counts and names addresses for folding long To/Cc lists. |
| `snippets.ts` | Finds hidden text (signatures…) in plain text, ignoring spacing, case and formatting marks. |
| `labelColors.ts` | The Gmail label colours WorkDesk offers. |
| `gmailUrl.ts` | Builds the "open in Gmail" link for an email. |

## `src/sw/`

| File | What it does |
|---|---|
| `sw.js` | Service worker: keeps the app and the last data for offline viewing, shows phone notifications and sets the icon badge, opens WorkDesk when a notification is tapped. |

## `src/client/` — the app in the browser (React)

| File | What it does |
|---|---|
| `index.html` | The page shell: start-up logo, dark mode set before the first paint, home-screen app settings. |
| `main.tsx` | Starts the app: query cache, error safety net, auto-update, service worker. |
| `App.tsx` | The frame of the app: top bar, side rail (computers), bottom tab bar (phones), routes to every page (Registers in the rail after Files) (old `/history` and `/import-export` links open those Settings tabs), account menu (side panel on phones), status in the title, database-problem pop-up, icon badge.; the bell (`Notifications`) also lists changes an assistant made since they were last looked at.. Computers: `Sidebar` (labelled buttons in My work / Office groups or icons only, saved per device; WorkDesk name and status at its top, its line meeting the top bar's). |
| `api.ts` | All calls to the server and the data hooks screens use (emails, tasks, reminders, events, tags, labels, staff, files, logins, settings). Leave types and accounts (`useLeaveTypes`, `useLeaveAccount`, `useLeaveActions`, `useAllLeaves` for the Leave page), gazetted posts. |
| `queryClient.ts` | The data cache saved on the device (`CACHE_VERSION` must go up when API data changes shape). (27: gazetted and probation declared; 28: marking leave; 29: automatic leave credits; 30: leave that delays increment; 31: KSR leave types, medical certificate, terminal surrender.) |
| `connection.ts` | Online/offline status and last sync time for the title bar; saves lists for offline use. |
| `autoUpdate.ts` | Reloads the app once when a newer version has been deployed. |
| `dbStatus.ts` | Remembers a database problem the server reported, for the pop-up. |
| `push.ts` | Turns phone notifications on/off on this device; sets the app icon badge. |
| `theme.ts` | Light / Dark / Automatic, saved on the device. |
| `format.ts` | Shows dates and times the friendly way ("Today", "Tue 7 Oct", "10:30 am"). |
| `fonts.ts` | The Malayalam font for email and Word preview frames. |
| `snippets.ts` | Removes hidden text from HTML emails; HTML to plain text for sharing. |
| `addressLists.ts` | Folds long recipient lists inside HTML emails ("and 38 more"). |
| `driveLinks.ts` | Finds Google Docs/Sheets/Slides/Drive links in an email for previews. |
| `taskDelete.ts` | Deleting tasks with a 5-second Undo before the server is told. |
| `saveFile.ts` | Saves a made file: share sheet on phones, download on computers. |
| `styles.css` | Design rules: Apple text sizes, colours (and dark mode), 44px tap areas, app shell on phones, sheets and action sheets, animations. |
| `vite-env.d.ts` | Type notes for build-time values (the version number). |
| `public/manifest.webmanifest` | Home-screen app name, icons and colours. |
| `public/icon-180.png`, `icon-192.png`, `icon-512.png` | App icons (iPhone home screen, Android, install). |
| `public/fonts/noto-sans-malayalam.woff2` | Malayalam font file (downloaded only when Malayalam is on screen). |
| `public/fonts/noto-sans-malayalam-OFL.txt` | The font's licence. |

### `src/client/pages/` — one file per screen

| File | Screen |
|---|---|
| `Home.tsx` | Home: four stat cards, Due Today (Today / Overdue / Upcoming, with today's events and increments), To-do card (calendar tiles, selection bar), Pending Emails card. Joining / relieving tasks, and Pension papers tasks, each shown together as one line on both task cards, tap to show them (`withFoldGroups`, `MoveGroup`, `PensionGroup`, `FoldGroup`); leave tasks (leave paperwork and surrenders) fold into one line too (`LeaveGroup`). |
| `Inbox.tsx` | Emails: Pending / Other sections / Removed / All tabs, search, label and unread filters, toolbar; on wide screens an opened email shows in a pane beside the list (split mode). |
| `Tasks.tsx` | Tasks: views (Today, Upcoming, No date, Waiting, Completed…), in priority order. |
| `Reminders.tsx` | Reminders: Due next and All reminders; tap opens Reminder details. |
| `Calendar.tsx` | Month calendar of tasks, reminder dates and events (app-style on phones, the whole width on big screens), with the chosen day's list and an Event button. |
| `Events.tsx` | Events: Upcoming / Today / Past, search, grouped by day; swipe (phones) or ⋮ menu for Done, Cancel, Edit. |
| `History.tsx` | Every decision and change, with Undo where possible; shown as the History tab of Settings (`embedded`: no page title, the filters as buttons). |
| `Search.tsx` | Search across emails and tasks. |
| `Settings.tsx` | Settings in tabs (the tab is in the address: none, `#mail`, `#employees`, `#events`, `#registers`, `#tags`, `#calendar`, `#assistant`, `#assistant-help`, `#history`, `#import-export`): General (Appearance, Notifications, Gmail connection, Office details), Mail (hidden senders, hidden text, labels, task labels, sections), Employees, Events (event types), Registers, Tags, Calendar link, Assistant (ChatGPT / Gemini), Assistant help, History, Import / Export. Leave tab (`#leave`) after Employees. |
| `Staff.tsx` | Employees page: due increments (Mark done asks the new basic pay), retiring within 12 months (with Pension papers progress), joining & relieving (`MovesCard`; the phones' + opens Join, no Add employee button), on computers (1024px+) a Permanent or Temporary table with a switch (click a PEN to copy it, on the phone list too), on narrower screens the permanent/temporary filter, list by designation, employee card, add/edit form. The employee form has Probation declared and Gazetted officer Yes / No (a gazetted post fills it); `GazettedTag`. On leave tag (the On leave card moved to the Leave page). |
| `EmployeePage.tsx` | An employee's own page (`/employees/<id>`, opened from the list or table; Join / Relieve): at a glance (pay, increment, probation, retirement / contract), every detail, tasks open and completed, reminders, their website logins, events they attend, History; Edit, Left the office, Delete. Leave: one summary line (balances and where they stand) opening the Leave page for them (the Leave account card moved there, 2026-10-31); probation follows the Probation declared switch; Gazetted tag. |
| `Files.tsx` | File register: one-line list (icon, e-file number column, subject), search, status filters and a Tags filter (several at once), add/edit form with tags. |
| `Leave.tsx` | Leave page (`/leave`): every leave, newest first under month headings, with its state and steps (tap to edit); filters by employee (`?employee=`, which also shows their Leave account card first), leave type and state (All / On leave / Due back / Upcoming / Rejoined / Cancelled); Mark leave (header, + on phones); days of each type in the list. |
| `Registers.tsx` | Registers page: all pending entries (filter by employee needed, General for unassigned, and register; Show done) beside a one-line card per register (Updated button: updated until today and done entries cleared; its entries, a quick-add line); New entry form. |
| `Logins.tsx` | Logins page: saved website logins grouped by website, search, + button, add/edit form. |
| `ImportExport.tsx` | Import / Export: master backup, CSV export/import with preview, sample CSV links; shown as the Import / Export tab of Settings (`embedded`). |
| `Login.tsx` | Sign in with Google. |

### `src/client/components/` — parts used by the screens

| File | What it does |
|---|---|
| `ui.tsx` | Basic building blocks: buttons, cards, page header, + button, tabs, pop-ups (`Modal`), action sheets, menus, tick circles, spinners, loading rows. |
| `sheet.ts` | Phone detection and pull-down-to-close for sheets. |
| `SidePanel.tsx` | The phone Account panel that slides in from the right. |
| `SwipeRow.tsx` | Swipe actions on phone rows, and the Undo bar. |
| `RefreshButton.tsx` | The refresh button on screens and lists. |
| `ErrorBoundary.tsx` | Safety nets: the whole app ("Something went wrong — Reload"), one page ("This page hit a problem", the menu keeps working) and one attachment preview ("Couldn't preview this file"). |
| `DatabaseIssue.tsx` | Explains a paused or unreachable database, with Neon usage link and Try again. |
| `Avatar.tsx` | Initials circles in the sender's colour; tap to select an email. |
| `ThreadRow.tsx` | One email row (sender, subject, preview, tags; on phones swipe left for Event / Remove; highlighted while open in the split pane). |
| `EmailBulkBar.tsx` | The email list toolbar: Select all, Create task, Remove, Restore, label and unread filters. |
| `EmailStatus.tsx` | Status tags on emails (Task, Removed, Event, With section, Back from section, Already done on …). |
| `EmailViewer.tsx` | Reading an email: conversation, attachments and previews (PDF, pictures, Excel, Word, PowerPoint text; old .doc/.ppt explained), labels, Share, Remove, make a task; `EmailPane` is the same reader as the Emails page's split pane (body first, attachment previews below). |
| `PdfPreview.tsx` | PDF pages drawn with pdf.js (loaded only when needed). |
| `SheetPreview.tsx` | Excel/CSV attachments as a table (SheetJS). |
| `DocxPreview.tsx` | Word .docx attachments as a page (mammoth). |
| `SlidesPreview.tsx` | PowerPoint .pptx attachments as each slide's text (fflate unzip; titles, points, tables). |
| `LabelChips.tsx` | Gmail label chips, the label picker and the label filter. |
| `RemoveChooser.tsx` | Remove: "Just remove" or send to a section (a menu from the button on computers, an action sheet on phones); also `AnchoredMenu` (menus that grow from a button, or from where it was if it re-rendered). |
| `TaskRow.tsx` | One task row on the Tasks page (a Contract ends or Probation declaration task's tick asks instead). |
| `TaskDialog.tsx` | Add / edit task form (with links, as the reminder form). |
| `TaskDetails.tsx` | Task details card (an Emails section with Add email; the title opens the task's email, or an event prep task's event email): where it came from (email, reminder, made by system or by hand), steps, waiting, For, the task's links, Edit, Mark complete (Renew or end / Declare or extend for Contract ends / Probation declaration tasks) / Reopen. |
| `IncrementDialog.tsx` | "Increment done": asks the new basic pay before marking an increment done (Home and the Employees page), with Undo; lives once in the shell. |
| `SystemTaskChooser.tsx` | The choice a system task asks for when ticked or swiped anywhere: Renew / Contract ended for "Contract ends", Probation declared / Change due date for "Probation declaration"; lives once in the shell. |
| `InlineTaskEdit.tsx` | Change a task's date/time or priority straight from its chip. |
| `PriorityGroups.tsx` | Sorts task lists Urgent → High → Medium → Low, earliest first. |
| `Checklist.tsx` | Task steps: editor in the form, ticks in details (a step can show Waiting), "2/5" chip on rows.; `RowSteps`: a "2/7" button on Due Today rows that unfolds the steps to tick them in the row. |
| `Waiting.tsx` | Waiting for a reply: badge, Wait dialog. |
| `ReminderDialog.tsx` | Add / edit reminder form. |
| `ReminderDetails.tsx` | Reminder details card with document preview and Edit / Pause / Delete / Mark done. |
| `ReminderLinks.tsx` | Link chips and the links editor, for reminders and tasks. |
| `EventDialog.tsx` | Add / edit event form (types from Settings › Events; compact: title with the attendee button, type, date and times, venue and link, the rest under More fields) (also Make event from an email, filled from it); lives once in the shell (`openEventForm`). |
| `AttendeePicker.tsx` | Who attends an event: the people button in the event title box, chips of those chosen, and a picker that ticks several (a designation's "(all)" adds everyone of it). |
| `EventDetails.tsx` | Event details card (an Emails section with Add email, opened in its own email viewer) for one date: Mark done, Move, Cancel, Not done / Restore, Back to the first date, Edit, Delete, Join meeting, Directions; lives once in the shell (`openEventDetails`). |
| `Logins.tsx` | Saved website logins: grouped list, a login row with Show / Copy (password fetched only then; shown for 30s), the add/edit form. Used by the Logins page and an employee's page. |
| `Tags.tsx` | Tags: chips (compact on rows, at most 2 on phones), the picker in task and reminder forms (most-used first, type to make one), the All tags filter, the tag filter icon on the home cards, the several-tags filter (File register), Settings › Tags (rename, colour, delete, drag to arrange). |
| `Related.tsx` | "For" an employee, designation or the office: picker, tag and line; `employeesOnly` limits it to one employee (register entries). |
| `Designations.tsx` | Settings › Employees: designations and types of temporary employees lists (add, rename, drag to arrange, remove); its list editor (`NameList`) is also used for event types. |
| `LeaveSettings.tsx` | Settings › Leave: leave types (the built-in KSR ones with a KSR tag, rule and Off tag; the office's own added / removed; edit with their rules and KSR limits, Reset to KSR, switch off; drag to arrange), Credit now (year, days, date; shows who gets it first) and gazetted posts (tick a designation, its employees follow). "Credit it automatically on each service anniversary" in the type form. "Doesn't count for increment or probation" in the type form. |
| `LeaveAccount.tsx` | An employee's Leave account card: balance of each leave that keeps one, every line newest first, and Add (opening balance from the service book, credit, adjustment) with the balance before and after. Phase 2: Mark leave, their leaves (state, type and days, dates, steps chip opening the task; tap to edit), LND used of its limit; `LeaveRow`, `leaveState`. Entry has Surrender (steps already done, more-than-balance warning, the financial year's 30 days, At retirement). Leave rows say "medical certificate"; their status is the step of the task changed last (`lastStep`), opening the task, with the leave's state in the date line. |
| `LeaveDialog.tsx` | Mark leave / edit a leave: employee, type, from, to, days (follow the dates until typed), rejoined on, order, notes, the balance before and after with warnings (not enough, past the service limit), steps already done; Cancel leave. For a leave that doesn't count for increment (EOL): Move the next increment / the probation task (ticked), with Undo after marking. On a medical certificate tick; the KSR limits crossed as warnings; switched-off types not offered. |
| `OnLeave.tsx` | The On leave tag on Employees list and table rows (the On leave card moved to the Leave page, 2026-10-31). |
| `YouSetting.tsx` | Settings › Employees, "You": choose which employee you are (saved at once; their row and page show a "You" tag). |
| `StaffMoves.tsx` | Joining & relieving: the Employees page card (one line until its title is clicked; Joined / Relieved tables, a Pending / Waiting / Done pill per step, people with their steps on phones, Show finished) and the Join / Relieve form (with Add a new employee); `JoinExistingCard` in Settings › Employees puts someone already working here into the joining process with the steps already done ticked; `RelieveExistingCard` beside it does the same for relieving (also someone marked Left, or a new employee added there). |
| `Registers.tsx` | Registers: Settings › Registers list, the entry form (register, what with the person button for Needs, optional task with a due date, remove) and an entry's row (tick, swipe on phones). |
| `LinkedEmails.tsx` | The Emails section of Task details and Event details (main email first, added ones with ✕, tap to open) and the Add email picker (Pending emails, search, tick several). |
| `AssistantSettings.tsx` | Settings › Assistant: what an assistant can read, the address with Copy, how to connect ChatGPT and Gemini, the Allow changes switch with changes an hour and Allow staff actions under it (greyed out while changes are off), connected assistants with Disconnect, and the assistant log (Everything / Changes only, what each change touched, Show older).; Export CSV of what the log shows; opening the tab marks the assistant's changes as seen (the bell clears).; a "See every command" link to Assistant help. |
| `QueueSettings.tsx` | Settings › Queue: Run now, counts waiting / running / needing your check / failed, what the last run did, work waiting, running, failed or waiting for your check (Retry, Discard), the Calls log (each request or run with calls used of the limit, failed / ran out / saved badges, tap for every call; All / Failed only, the queue's own checks hidden unless ticked, Show older) and recently done jobs. |
| `AssistantHelp.tsx` | Settings › Assistant help: how to use the assistant, the current Allow changes / Allow staff actions state, a search box, and every command and prompt by group with its kind badge, name, hint, a copyable example and notes. |
| `OfficeDetails.tsx` | Settings › General › Office details: office name and address, phone, email, seat, signature block, file number pattern, usual recipients and office codes (editable lists), letter language; Save. |
| `EventTypes.tsx` | Settings › Events: the event types list (add, rename, drag to arrange, remove; a removed type's events show as "Event"). |
| `SortableList.tsx` | Drag and drop to arrange a list (grip handle; mouse, touch and keyboard; auto-scroll near the edges). Used for every list whose order the user sets. |
| `NotificationSettings.tsx` | Settings › Notifications. |

## `tests/` — automatic checks (`npm test`)

| File | What it checks |
|---|---|
| `gmail-safety.test.ts` | WorkDesk can't change Gmail beyond mark-read and the user's own labels. |
| `mark-read.test.ts` | Opening an email removes only the Unread label. |
| `sync.test.ts` | Gmail sync downloads each message once and continues the 30-day backfill. |
| `queue.test.ts` | Background queue: the calls budget and its reserve, jobs run in order, nothing lost when a run has too few calls (work waits, a sync downloads what fits, a notification isn't marked sent), retries then failed, cut-off jobs queued again, Settings › Queue routes. |
| `call-log.test.ts` | Calls log: calls named without their data, one row per request, an inner request logged with the outer one, failed reads logged only, a failed change saved and done again by the queue, a half-saved one waiting for a check with Retry / Discard, a refused change failing at once, refused pushes resent then dropped when late, the queue's own checks hidden, log cleanup after 2 / 30 days. |
| `thread-rules.test.ts` | What a new reply does to removed, task and section emails. |
| `bulk-actions.test.ts` | Tick-several actions on emails; old snoozed emails come back. |
| `send-to-section.test.ts` | Remove → Send to a section, and its Undo. |
| `task-labels.test.ts` | Task/done labels both ways, and sections of the office. |
| `labels-everywhere.test.ts` | Labels on emails, filters, deleting a label. |
| `email-content.test.ts` | Reading email bodies and attachments. |
| `email-tags.test.ts` | Status tags on emails. |
| `address-lists.test.ts` | Folding long recipient lists. |
| `assistant-help.test.ts` | Assistant help lists every MCP command and prompt once, with the kind the server enforces and the same titles as the assistant log. |
| `drive-links.test.ts` | Finding Google file links in emails. |
| `snippets.test.ts` | Hidden text matching. |
| `muted-senders.test.ts` | Hidden sender addresses and domains. |
| `find-dates.test.ts` | Due dates found in email text. |
| `partial-updates.test.ts` | Edits change only the fields sent. |
| `task-checklist.test.ts` | Task steps saved and ticked. |
| `task-links.test.ts` | Links on tasks: saved (also on a task from an email), changed only when sent, web links only. |
| `task-waiting.test.ts` | Waiting for a reply. |
| `task-delete.test.ts` | Deleting tasks from the To-do card. |
| `reminders.test.ts` | Reminder date maths and task creation. |
| `reminder-links.test.ts` | Links on reminders. |
| `calendar-feed.test.ts` | The calendar link's `.ics` file. |
| `push.test.ts` | Push encryption, VAPID signature, notification schedule. |
| `staff.test.ts` | Designations (and their drag-and-drop order), employees (permanent/temporary), types, increments, basic pay, the employee page's tasks / reminders / History, Contract ends tasks (renew / ended complete them, Undo reopens), "For" links.; day off (Sunday off unless chosen, kept when a form leaves it out, the CSV column). |
| `probation.test.ts` | Probation declaration tasks (made once, recent joinings only), declared with Undo, changed due date, declared in the form. |
| `leave.test.ts` | Leave phase 1: the usual types (commuted / LND take from HPL), type checks and removal, account lines (opening once, credit, adjustment, lapse above the most kept, temporary staff refused, History), Credit now once per year, Gazetted from the designation and kept when left out, Probation declared (no task while yes, set by the task's choice), the Employees CSV Yes / No columns. Phase 2: marking (balance, task with steps due on rejoining, all steps done completes), gazetted steps, commuted double HPL, LND below zero, EOL nothing, edit / rejoin / cancel lines, overlap refused, the current list. Phase 3: automatic HPL and EL-from-duty credits (switched-on date, once a year, opening date, probation declared, lapse), the leave balances file, the backup into an empty WorkDesk. Phase 4: EOL moves increment and probation with Undo, surrender with its task. The Leave page's list of every leave; each step keeps when it last changed. KSR: the built-in types and figures, an older type adopted, edit / reset / switch off / never removed, the limit warnings and one run of leave, the medical certificate (LND counted apart, EOL moves nothing), terminal surrender. |
| `pension.test.ts` | Pension papers tasks 12 months before retirement (made once, checklist, "For" the employee) and the Retiring within 12 months list. |
| `file-register.test.ts` | File register entries and e-file numbers. |
| `logins.test.ts` | Saved website logins: many per website, employee or role, passwords encrypted, never in lists, revealed only on request and noted in History. |
| `tags.test.ts` | Tags: reused whatever the capitals, on tasks (filter, search, keep on edit), a reminder's tags on its tasks, deleting cleans up, the Tags column of the Tasks CSV. |
| `done-before.test.ts` | An email back in Pending after its task was done carries when it was done ("Already done on …"). |
| `me-employee.test.ts` | Which employee the user is: set, checked, cleared, in History, forgotten when that employee is deleted. |
| `moves.test.ts` | Joining and relieving: the task and its steps, the table and the task kept in step both ways, done completes / set back reopens, Left on the relieving date, deleting the task drops the row, starting with steps already done, relieving someone marked Left or a new employee. |
| `registers.test.ts` | Registers: added in Settings, updated until, delete with entries; entries not tasks without a due date, entry and task kept in step both ways, due date removed takes the task away. |
| `linked-emails.test.ts` | More emails on a task or event: added from Pending, a new reply flags the task, status follows the task, taken off or deleted they come back to Pending. |
| `mcp.test.ts` | Assistants (MCP): sign-in details, registration, consent (Allow / Cancel), PKCE, one-use codes, refresh tokens replaced on use, Disconnect; every tool answers with names not ids; reading an email changes nothing; a PDF attachment as text; the assistant log; no tool ever returns a saved password.; Phase 3: nothing changes while Allow changes is off; tasks, emails, register entries and events change as in the app (Malayalam titles, steps, tags, For), History marked via the assistant, the log has what changed, unclear names answered with choices, at most 10 items, the hourly limit, Contract ends / Probation tasks not ticked; the MCP code never calls Gmail itself.; Phase 4: staff actions refused without their own switch, then join with steps done, step states, increment with the new basic pay (not again until due), employee details changed without losing others, probation, relieve, temporary contract worked out, renewed and ended, register marked updated.; Phase 5: the four prompts (arguments, month range, missing / unknown ones), the bell's unseen changes (reads don't count; seen clears), the log CSV.; `use_prompt` gives the same instructions as the prompt.; an assistant known by its metadata document address (as ChatGPT) connects, read with redirect "manual", and a document that can't be read gives the reason.; office details (saved, in Settings for assistants and the reply prompt, in the backup), reminders created / changed / paused / dates marked, file register entries added and changed (e-file number clash names the other), the new prompts. Leave: get_leave_account and mark_leave. |
| `office-events.test.ts` | Events: the user's own types (add, rename, arrange, delete keeps events, CSV makes new ones), repeat dates and changes, preparation tasks, Make event from an email (and back to Pending on a reply), delete, Home today, the calendar feed, the Events CSV, the phone note within the hour before. |
| `attachment-types.test.ts` | Pictures and PDFs labelled as generic files are served with their real type. |
| `import-export.test.ts` | CSV import/export, samples, and the master backup. |
| `db-errors.test.ts` | Database problems explained in plain words. |
| `crypto.test.ts` | Session signing and token encryption. |
