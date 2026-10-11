# WorkDesk

*Every email accounted for. Every task tracked.*

## Who it's for

WorkDesk is for **anyone whose work arrives by email**: someone who is assigned jobs, requests, circulars and
reminders through their Gmail inbox and has to make sure nothing is forgotten. It was built for a section of the
Kerala Health Services (letters from the District Medical Office, HMIS, NHM, HMC, pharmacy…), but it suits any office
desk run from a Gmail inbox.

## The problem it solves

In a busy inbox, important requests get buried, deadlines are missed and "did I reply to that?" is hard to answer.
WorkDesk sits on top of Gmail and turns the inbox into a **to-do system**:

1. Every new email lands in **Pending** and waits for a decision.
2. You decide: **make it a task** (with a due date), **send it to another section**, or **remove** it.
3. Tasks stay linked to their email, and **History** records every decision, so you can always see what happened.

It is a single-person app: only the owner's Google account can sign in. It runs in a computer's browser and as an
app on the iPhone home screen, and it speaks Malayalam as well as English.

## Features

### Home
- **At a glance:** four counters: pending emails, pending jobs, work due today, upcoming reminders.
- **Due Today:** today's tasks with overdue ones first, plus upcoming tasks and reminders (tabs), increments due.
- **To-do:** your open tasks, tasks waiting for a reply, and completed ones; tick several to act on them together.
- **Pending emails:** the emails still waiting for a decision.
- **Tag filter:** a small filter icon on the Due Today and To-do cards shows only tasks with one tag.

### Emails
- **Pending / Other sections / Removed** tabs, plus All emails, with search and Unread / label filters.
- **Read inside WorkDesk:** the whole conversation, with long address lists folded and repeated signatures hidden
  (**Hidden text**). Opening an email marks it read in Gmail too.
- **Attachment previews:** PDF, pictures, Excel/CSV, Word and PowerPoint (slide text), and Google Docs/Sheets/Drive
  links found in the email. Old .doc/.ppt files explain why they can't be shown, with Download.
- **Decide in one tap:** Create task, Remove (or **send to another section**), Restore; select many at once.
- **Share** an email with its attachments, e.g. to WhatsApp.
- **Hide senders:** newsletters and similar senders can skip Pending (they stay under All emails).

### Tasks
- **Due date and time, priority, notes**; lists run Urgent → High → Medium → Low.
- **Checklist:** steps inside a task, ticked off one by one.
- **Waiting for a reply:** park a task with the date a reply is expected; it shows in Due Today when that day comes or the reply is late.
- **"For":** link a task to an employee, a designation or the whole office.
- **Tags:** your own coloured tags (e.g. Salary, Audit); filter and search by them.
- **Quick edits:** change the date, time or priority straight from the task's chips; on phones, swipe right to
  complete and swipe left for more, with Undo.
- **New reply:** a task is flagged when its email gets a new message.
- **Automatic tasks:** WorkDesk makes tasks for contracts ending, probation declarations and pension papers (see
  Employees).

### Reminders
- **Anything that comes round again:** monthly reports, meetings, bill payments: a date, optional time, repeat
  (daily to yearly), an end date and "remind me" days before.
- **Each date becomes a task** ahead of time; ticking either one ticks both.
- **Links** to the Google Sheet, Doc or folder you need, **tags**, and a link to an employee or designation.
- **Pause / resume**, and a details view with past and next dates.

### Calendar
- **Month view** of tasks and reminders; tap a day for its list.
- **Private calendar link** to see everything in Apple Calendar, Google Calendar or Outlook (read-only copy).

### Employees
- **Permanent and temporary staff** with their details (PEN, phone, dates of birth, joining, increment, retirement,
  pay, contract…), grouped by **designation** (drag to arrange).
- **Each employee's own page:** every detail, their tasks, reminders, saved website logins and history.
- **Increments:** due increments show on Home; "Mark done" asks the new basic pay and moves the date a year on.
- **Contracts ending:** a week before, a task asks to renew or end the contract.
- **Probation:** near two years of service, a task to declare probation or change the date.
- **Retiring within 12 months:** a list, and a Pension papers task with the pension checklist.

### File register
- **The office's files:** old physical files and e-files with their numbers; search, and tap a number to copy it.

### Logins
- **Saved logins for office websites:** e.g. each employee's SPARK login, or the shared DDO and section clerk
  logins for BiMS. One website can have many logins.
- **Safe by design:** passwords are stored encrypted, stay hidden until you tap Show or Copy, hide again after 30
  seconds, and each Show or Copy is noted in History.

### Search and History
- **Search** across emails and tasks (title, notes, subject, sender, tag names).
- **History:** every decision and change (emails decided, tasks completed, labels changed, passwords shown…), with
  Restore for removed emails.

### Gmail labels and sections
- **Labels:** create, rename, recolour and delete your Gmail labels, and add or remove them on an email.
- **Task and done labels:** emails that are tasks (or done) get a chosen label in Gmail, and the other way round.
- **Sections of the office:** an email with another section's label moves to "Other sections".

### Notifications
- **Bell** in the top bar: overdue, due today, new replies.
- **Phone notifications** (iPhone home-screen app): a morning summary at a time you choose, a note when a task is
  due, and the app icon's badge.

### Import / Export
- **Master backup** of everything WorkDesk keeps, and a restore that only adds what's missing.
- **CSV import/export** (with sample files) for the file register, employees, tasks and reminders (with tags).

### Settings
- **General:** light / dark / automatic appearance, phone notifications, the Gmail connection.
- **Mail:** hidden senders, hidden text, task/done labels, sections, your Gmail labels.
- **Employees:** designations and types of temporary employees.
- **Tags:** rename, recolour, delete and arrange your tags.
- **Calendar:** the private calendar link.

### Works like a phone app
- **Install** it on the iPhone home screen; swipe actions, bottom sheets, pull down to refresh.
- **Offline viewing** of what was last loaded; it updates itself when a new version is deployed.
- **Safety nets:** if one page or one attachment preview fails, only that part shows a message.

## What WorkDesk does and doesn't do to Gmail

**Gmail is only changed in the ways the owner approved (2026-10-06):** opening an email in WorkDesk marks that
conversation read, and the owner's own labels can be created / renamed / recoloured / deleted and added to or removed
from an email. System labels (Inbox, Trash, Spam, Unread…) can't be touched. WorkDesk asks for `gmail.modify`, but the
code has no way to delete or trash emails, archive, or send anything, and `tests/gmail-safety.test.ts` fails if any such
code is added. Removing an email, completing a task, tags and importing data never touch Gmail.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. You don't need any accounts for this. With no `.env` file, WorkDesk:
- keeps its database in `./.data` (PGlite, an embedded Postgres), and
- signs you in as a demo user with sample emails and reminders. In demo mode, **Simulate new email** stands in for Sync.

To start again with fresh demo data, stop the server and delete `.data`.

| Command | What it does |
|---|---|
| `npm run dev` | API on :8787 plus the dashboard on :5173 |
| `npm test` | Unit tests, including the Gmail safety check (at most 8 test files at a time, see `vitest.config.ts`) |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Create a migration after changing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to Neon (if `DATABASE_URL` is set) or to the local database |
| `npm run deploy` | Build the dashboard and deploy the Worker |

## Connect real Gmail

### 1. Google Cloud OAuth client
1. In https://console.cloud.google.com, create a project (for example "WorkDesk").
2. Go to **APIs & Services → Library**, find **Gmail API**, and enable it.
3. Under **Google Auth Platform → Branding / Audience**, set up the consent screen. If your mailbox is a Google Workspace account, choose **Internal**. If it's an ordinary @gmail.com account, choose **External** and add yourself as a test user.
4. Under **Data access**, add the scope `.../auth/gmail.modify` (reading, plus marking opened emails read).
5. Under **Clients**, create a **Web application** client with these authorized redirect URIs:
   - `http://localhost:5173/api/auth/google/callback`
   - `https://<your-worker>.workers.dev/api/auth/google/callback` (add this once it's deployed)

> **Heads-up:** while an *External* app is in **Testing** status, Google expires its refresh tokens after 7 days, so you'd have to sign in again every week. Internal (Workspace) apps don't have this limit. Check Google's current rules for restricted scopes before you publish an External app: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

### 2. Local `.env`
Copy `.env.example` to `.env`, then fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL` (your Gmail address; nobody else can sign in), and two random secrets:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
```

Run that twice: once for `SESSION_SECRET` and once for `TOKEN_ENC_KEY`. Then restart `npm run dev` and sign in.

### 3. Neon database
Create a project at https://neon.tech, put its connection string in `DATABASE_URL`, and run `npm run db:migrate`.

### 4. Deploy to Cloudflare
```bash
npx wrangler login
```
```bash
npx wrangler secret put DATABASE_URL
```
Do the same for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`, `SESSION_SECRET`, `TOKEN_ENC_KEY`, and `APP_URL` (your `https://….workers.dev` address). Then:
```bash
npm run deploy
```
One Worker serves both the dashboard and the API, and a cron trigger syncs Gmail and sends due phone notifications every 10 minutes. Phone notifications need no extra secret: WorkDesk makes its own key pair the first time.

### 5. Automatic deploys from GitHub
Every push to `master` deploys itself through `.github/workflows/deploy.yml`. It runs the typecheck and tests (a failing check stops the deploy), applies database migrations to Neon, builds the dashboard, and publishes the Worker. Add three secrets once under the GitHub repository's **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | From https://dash.cloudflare.com/profile/api-tokens, using the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID (`npx wrangler whoami` shows it) |
| `DATABASE_URL` | The Neon connection string from `.env.production` |

You can follow each run in the repository's **Actions** tab, and start one by hand with **Run workflow**. `npm run deploy` still works for a manual deploy from your PC.

## How it fits together

```
src/
  client/   React app: pages/ (one file per screen), components/ (shared parts), api.ts (calls to the server)
  server/   Hono API: app.ts (sign-in, routes), routes/ (endpoints), lib/ (Gmail, sync, reminders, notifications…),
            db/schema.ts (tables), worker.ts (Cloudflare + cron), dev.ts (local)
  shared/   Rules and types used by both sides (reminder dates, staff, import/export columns, checks)
  sw/       Service worker: offline copy and phone notifications
drizzle/    Database migrations, applied in order
tests/      Automatic checks (npm test), including the Gmail safety check
```

**Every file and what it does is listed in [docs/FILES.md](docs/FILES.md).**

**Email states:** *Pending* (needs a decision), *task*, *Other sections* (another section's label is on it), or *Removed*. These rules keep work from getting lost:
- If a new message arrives in a removed conversation, or one handled by another section, it goes back to Pending.
- If a new message arrives in a conversation whose task is still open, the task is flagged "New reply".
- If a new message arrives after the task was completed, the conversation goes back to Pending.
- A removed email can be restored from History or from the Emails page's Removed tab.

**Easy on Gmail and the database:** the first sync lists the last 30 days; after that only Gmail's change log is read, and each message is downloaded once (read/unread changes need no download). The browser keeps a saved copy of loaded screens, so pages open without database reads and can be viewed offline; every screen refreshes on demand (refresh button, or pull down on phones).

**Task labels (Settings → Mail):** pick one Gmail label for emails that are tasks and one for emails whose task is done. WorkDesk keeps them in step both ways: turning an email into a task adds the task label in Gmail, completing it swaps in the done label (reopening swaps back), and any email that gets either label, in Gmail or in WorkDesk, becomes an open or completed task. Every other label of yours is another section of the office, unless you tick it as only for organising mail.

**What's stored:** for each email, only the subject, sender, Gmail snippet, dates, and IDs. Message bodies are never stored. Refresh tokens, the notification key and saved website passwords are encrypted with AES-GCM (`TOKEN_ENC_KEY`); passwords are never part of lists, the offline copy or Import/Export.

**Tags vs labels:** Gmail labels belong to emails (and mark the office's sections). Tags are WorkDesk's own, for tasks and reminders only, and never reach Gmail. Manage them in Settings → Tags.

## Version number

The version (e.g. **v1.154**) shows in small grey next to "WorkDesk" for a few seconds after the app opens (then the sync status takes its place; tap it to see the version again), at the bottom of Settings and on the sign-in page. It is worked out from git when the dashboard is built (`vite.config.ts`):

- **MINOR** goes up by one with every commit.
- **MAJOR** changes only on a major update. Mark one with a tag, then deploy; the version restarts at `.0` and counts on from there:
  ```bash
  git tag v2
  ```
- With no tag yet, the major number is 1.

The live site shows the version it was deployed with, so commit before `npm run deploy`. The local dev server picks up a new number when it restarts.

## Roadmap
- [x] Gmail queue: Create task / Remove / Restore / Open in Gmail, with History
- [x] Tasks with due dates, times, priorities, notes, checklists and waiting for a reply
- [x] Reminders: date, time, repeat (daily to yearly), end repeat and "remind me", with links to Google files
- [x] Gmail labels, task/done labels and sections of the office
- [x] Calendar page and private calendar link
- [x] Phone app: swipe actions, sheets, offline viewing, notifications, dark mode
- [x] Employees (permanent and temporary), designations, increments; file register
- [x] Import / Export: master backup and CSV
- [x] Saved website logins (encrypted passwords)
- [x] Tags for tasks and reminders
- [x] Attachment previews: PDF, pictures, Excel, Word, PowerPoint (text)
