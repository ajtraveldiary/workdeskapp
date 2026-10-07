# WorkDesk files

Every file in the project and what it does, folder by folder. When a file is added, removed, renamed or
changes what it does, update its line here in the same commit (see CLAUDE.md).

How the parts connect:

```
Browser (src/client)  ──/api/*──▶  Hono API (src/server/app.ts + routes/)  ──▶  Database (Neon / PGlite)
      │                                   │
      │ service worker (src/sw)           └──▶  Gmail API (lib/gmail.ts, read + approved label/mark-read only)
      └─ shared rules and types (src/shared), used by both sides
Cron every 10 min (src/server/worker.ts): Gmail sync, then phone notifications
```

## Project root

| File | What it does |
|---|---|
| `README.md` | What WorkDesk is, how to run it locally, connect Gmail and deploy. |
| `CLAUDE.md` | Rules for working on the code: Gmail safety, touch-first design, and every feature decision the user made. |
| `docs/FILES.md` | This file: every file and its job. |
| `package.json` / `package-lock.json` | Libraries and the npm commands (`dev`, `test`, `typecheck`, `db:generate`, `db:migrate`, `deploy`). |
| `tsconfig.json` | TypeScript settings for the whole project. |
| `vite.config.ts` | Builds the app: the version number from git (`appVersion`), `dist/version.json` for auto-update, and the service worker (`dist/sw.js`). Runs the dev server on :5173, passing `/api` to :8787. |
| `vitest.config.ts` | Test runner settings. |
| `drizzle.config.ts` | Where the database schema and migrations live, for `npm run db:generate`. |
| `wrangler.jsonc` | Cloudflare Worker settings: entry file, the built app as static files, the 10-minute cron, the time zone; lists the secrets to set. |
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

## `src/server/` — the API (Cloudflare Worker, or Node when run locally)

| File | What it does |
|---|---|
| `app.ts` | Builds the Hono API: Google sign-in (`/api/auth/google`), sign-out, session cookie, demo sign-in when Google isn't set up, database-error answers, and mounts every route file below. |
| `worker.ts` | Cloudflare entry: serves `/api/*`, the built app for everything else, and the 10-minute cron (Gmail sync, then phone notifications). |
| `dev.ts` | Local entry (Node, port 8787): Neon if `DATABASE_URL` is set, otherwise the local database; checks for phone notifications every 10 minutes, and syncs Gmail every 10 minutes when Google is set up. |
| `env.ts` | The Worker's settings and secrets (`Env`), the app time zone, and a helper that fails clearly when a secret is missing. |

### `src/server/db/`

| File | What it does |
|---|---|
| `schema.ts` | Every database table and column (Drizzle): users, Gmail accounts/messages/labels, hidden senders, hidden text, emails, tasks, reminders (`reports`) and their dates (`report_periods`), designations, employee types, employees, file register, push devices, History (`events`). |
| `index.ts` | The `DB` type both database drivers share. |
| `neon.ts` | Connects to Neon over HTTP (production). |
| `local.ts` | Local database with PGlite in `./.data` (no install needed); applies new migrations when it starts. |
| `migrate.ts` | `npm run db:migrate`: applies `drizzle/` to Neon or the local database. |

### `src/server/routes/` — API endpoints (all under `/api`)

| File | What it does |
|---|---|
| `threads.ts` | Emails: lists by state, one email, its content and attachments from Gmail, mark read, make a task, Remove / Restore (single and bulk), mark a new reply seen. |
| `tasks.ts` | Tasks: lists by view (today, overdue, upcoming, waiting, completed…), date ranges for the calendar, create, edit, complete, reopen, bulk delete (with Gmail task-label clean-up). |
| `reports.ts` | Reminders (stored as reports): list with their dates, create, edit, pause/resume, delete, mark a date done or not done. |
| `labels.ts` | Gmail labels: list, create, rename/recolour, delete, change an email's labels, task/done label settings, Send to a section (`/threads/bulk-section`). |
| `misc.ts` | `/me`, Home summary counts, History, hidden senders, hidden text, housekeeping (`/maintain`) and Sync now. |
| `staff.ts` | Employees page: designations, types of temporary employees, employees (add/edit, left the office, delete), an employee's open work, increment done. `employeeValues` keeps only the fields that fit permanent or temporary staff. |
| `files.ts` | File register: list, add, edit, remove; one entry per e-file number. |
| `calendar.ts` | Private calendar link: make/replace/turn off the link, and the public `.ics` feed it serves. |
| `push.ts` | Phone notifications: turn on/off for a device, what to send and when, send a test. |
| `transfer.ts` | Import / Export: master backup download and import (adds only what's missing), CSV export and import (preview, then in parts) for file register, employees, tasks and reminders. |

### `src/server/lib/` — the work behind the routes

| File | What it does |
|---|---|
| `gmail.ts` | The only code that talks to Gmail: read-only GETs from an allowlist, mark read, and the user's own labels. Enforced by `tests/gmail-safety.test.ts`. |
| `gmailAuth.ts` | Gets a fresh Gmail access token from the stored (encrypted) refresh token. |
| `sync.ts` | Gmail sync: first 30 days, then Gmail's change log; each message downloaded once; labels kept up to date; cron sync for all users. |
| `threadRules.ts` | What a new message does to an email that was removed, made a task, or sent to another section. |
| `taskLabels.ts` | Keeps the task/done Gmail labels and WorkDesk tasks in step both ways; catches up emails missing their label. |
| `sections.ts` | Sections of the office: moves emails with another section's label to "Other sections" and back. |
| `reports.ts` | Creates each reminder date and its task when it is due; marks a date and its task done together. |
| `emailContent.ts` | Reads an email's body and attachments from Gmail for the viewer (never stored); demo content. |
| `muted.ts` | Checks whether an email's sender is hidden from Pending. |
| `maintenance.ts` | Housekeeping on page loads, at most every few minutes: returns any old snoozed email to Pending, creates due reminder dates, applies section rules. |
| `ics.ts` | Builds the calendar file (`.ics`) for the calendar link, with Malayalam-safe line folding. |
| `notify.ts` | Decides which phone notifications are due (morning summary, due-time notes, badge count) and sends them. |
| `webpush.ts` | Web Push with WebCrypto only: encrypts a message for a device and signs it (VAPID). |
| `staff.ts` | Checks what a task or reminder is "for" (employee, designation, office) and names it for History. |
| `users.ts` | Creates the user on first sign-in; demo mailbox and demo reminders. |
| `audit.ts` | Writes a History (`events`) row. |
| `crypto.ts` | Signs the session cookie, encrypts refresh tokens and the push key (AES-GCM). |
| `dates.ts` | Today's date in the app time zone; adding days. |
| `dbErrors.ts` | Turns database failures (Neon paused by a usage limit, unreachable) into plain messages. |

## `src/shared/` — rules and types used by both the server and the browser

| File | What it does |
|---|---|
| `types.ts` | The shapes of data the API sends to the app (Thread, Task, Report, Employee, OfficeFile, Summary…). |
| `schemas.ts` | Checks on everything the app sends (Zod): tasks, reminders, labels, staff, files, notifications, hidden text. |
| `reminderSchedule.ts` | Reminder date maths: repeats, next dates, "remind me" lead days, labels like "Every month". |
| `staff.ts` | Employee lists and rules: categories, engaged as, common designations and types, contract end date, increment due dates. |
| `transfer.ts` | Import / Export: CSV columns of each list, sample files, CSV writing, reading dates/times/priorities, backup tables. |
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
| `App.tsx` | The frame of the app: top bar, side rail (computers), bottom tab bar (phones), routes to every page, account menu (side panel on phones), status in the title, database-problem pop-up, icon badge. |
| `api.ts` | All calls to the server and the data hooks screens use (emails, tasks, reminders, labels, staff, files, settings). |
| `queryClient.ts` | The data cache saved on the device (`CACHE_VERSION` must go up when API data changes shape). |
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
| `Home.tsx` | Home: four stat cards, Due Today (Today / Overdue / Upcoming, with increments), To-do card (calendar tiles, selection bar), Pending Emails card. |
| `Inbox.tsx` | Emails: Pending / Other sections / Removed / All tabs, search, label and unread filters, toolbar. |
| `Tasks.tsx` | Tasks: views (Today, Upcoming, No date, Waiting, Completed…), in priority order. |
| `Reminders.tsx` | Reminders: Due next and All reminders; tap opens Reminder details. |
| `Calendar.tsx` | Month calendar of tasks and reminder dates (app-style on phones), with the chosen day's list. |
| `History.tsx` | Every decision and change, with Undo where possible. |
| `Search.tsx` | Search across emails and tasks. |
| `Settings.tsx` | Settings: Appearance, Notifications, Gmail connection, Mail (hidden senders, hidden text, labels, task labels, sections), Employees, Calendar link. |
| `Staff.tsx` | Employees page: due increments, permanent/temporary filter, list by designation, employee card, add/edit form. |
| `Files.tsx` | File register: one-line list of files with e-file numbers, search, filters, add/edit form. |
| `ImportExport.tsx` | Import / Export: master backup, CSV export/import with preview, sample CSV links. |
| `Login.tsx` | Sign in with Google. |

### `src/client/components/` — parts used by the screens

| File | What it does |
|---|---|
| `ui.tsx` | Basic building blocks: buttons, cards, page header, + button, tabs, pop-ups (`Modal`), action sheets, menus, tick circles, spinners, loading rows. |
| `sheet.ts` | Phone detection and pull-down-to-close for sheets. |
| `SidePanel.tsx` | The phone Account panel that slides in from the right. |
| `SwipeRow.tsx` | Swipe actions on phone rows, and the Undo bar. |
| `RefreshButton.tsx` | The refresh button on screens and lists. |
| `ErrorBoundary.tsx` | Shows "Something went wrong — Reload" instead of a blank page. |
| `DatabaseIssue.tsx` | Explains a paused or unreachable database, with Neon usage link and Try again. |
| `Avatar.tsx` | Initials circles in the sender's colour; tap to select an email. |
| `ThreadRow.tsx` | One email row (sender, subject, preview, tags). |
| `EmailBulkBar.tsx` | The email list toolbar: Select all, Create task, Remove, Restore, label and unread filters. |
| `EmailStatus.tsx` | Status tags on emails (Task, Removed, With section, Back from section…). |
| `EmailViewer.tsx` | Reading an email: conversation, attachments and previews, labels, Share, Remove, make a task. |
| `PdfPreview.tsx` | PDF pages drawn with pdf.js (loaded only when needed). |
| `SheetPreview.tsx` | Excel/CSV attachments as a table (SheetJS). |
| `DocxPreview.tsx` | Word .docx attachments as a page (mammoth). |
| `LabelChips.tsx` | Gmail label chips, the label picker and the label filter. |
| `RemoveChooser.tsx` | Remove: "Just remove" or send to a section; also `AnchoredMenu` (menus that grow from a button). |
| `TaskRow.tsx` | One task row on the Tasks page. |
| `TaskDialog.tsx` | Add / edit task form. |
| `TaskDetails.tsx` | Task details card: steps, waiting, For, Edit, Mark complete / Reopen. |
| `InlineTaskEdit.tsx` | Change a task's date/time or priority straight from its chip. |
| `PriorityGroups.tsx` | Sorts task lists Urgent → High → Medium → Low, earliest first. |
| `Checklist.tsx` | Task steps: editor in the form, ticks in details, "2/5" chip on rows. |
| `Waiting.tsx` | Waiting for a reply: badge, Wait dialog. |
| `ReminderDialog.tsx` | Add / edit reminder form. |
| `ReminderDetails.tsx` | Reminder details card with document preview and Edit / Pause / Delete / Mark done. |
| `ReminderLinks.tsx` | Link chips on reminders and the links editor. |
| `Related.tsx` | "For" an employee, designation or the office: picker, tag and line. |
| `Designations.tsx` | Settings › Employees: designations and types of temporary employees lists. |
| `NotificationSettings.tsx` | Settings › Notifications. |

## `tests/` — automatic checks (`npm test`)

| File | What it checks |
|---|---|
| `gmail-safety.test.ts` | WorkDesk can't change Gmail beyond mark-read and the user's own labels. |
| `mark-read.test.ts` | Opening an email removes only the Unread label. |
| `sync.test.ts` | Gmail sync downloads each message once and continues the 30-day backfill. |
| `thread-rules.test.ts` | What a new reply does to removed, task and section emails. |
| `bulk-actions.test.ts` | Tick-several actions on emails; old snoozed emails come back. |
| `send-to-section.test.ts` | Remove → Send to a section, and its Undo. |
| `task-labels.test.ts` | Task/done labels both ways, and sections of the office. |
| `labels-everywhere.test.ts` | Labels on emails, filters, deleting a label. |
| `email-content.test.ts` | Reading email bodies and attachments. |
| `email-tags.test.ts` | Status tags on emails. |
| `address-lists.test.ts` | Folding long recipient lists. |
| `drive-links.test.ts` | Finding Google file links in emails. |
| `snippets.test.ts` | Hidden text matching. |
| `muted-senders.test.ts` | Hidden sender addresses and domains. |
| `find-dates.test.ts` | Due dates found in email text. |
| `partial-updates.test.ts` | Edits change only the fields sent. |
| `task-checklist.test.ts` | Task steps saved and ticked. |
| `task-waiting.test.ts` | Waiting for a reply. |
| `task-delete.test.ts` | Deleting tasks from the To-do card. |
| `reminders.test.ts` | Reminder date maths and task creation. |
| `reminder-links.test.ts` | Links on reminders. |
| `calendar-feed.test.ts` | The calendar link's `.ics` file. |
| `push.test.ts` | Push encryption, VAPID signature, notification schedule. |
| `staff.test.ts` | Designations, employees (permanent/temporary), types, increments, "For" links. |
| `file-register.test.ts` | File register entries and e-file numbers. |
| `import-export.test.ts` | CSV import/export, samples, and the master backup. |
| `db-errors.test.ts` | Database problems explained in plain words. |
| `crypto.test.ts` | Session signing and token encryption. |
