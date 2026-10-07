# WorkDesk

*Every email accounted for. Every task tracked.*

A personal office dashboard on top of Gmail, built for a section of the Kerala Health Services. Every email that comes in needs a decision: turn it into a task, send it to another section, or remove it. Tasks keep a link back to their email, and a History screen records every decision. It works in a computer's browser and as an iPhone home-screen app.

What's in it:
- **Home:** Pending emails, pending jobs, today's work (with overdue items and due increments) and upcoming reminders at a glance.
- **Emails:** Pending / Other sections / Removed; read emails with previews of PDF, Excel, Word and Google Docs attachments; share an email to WhatsApp; Gmail labels; sections of the office.
- **Tasks:** due dates and times, priorities, checklists, waiting for a reply, "for" an employee or designation.
- **Reminders:** repeating dates (reports, meetings, payments) with links to Google files; each date becomes a task.
- **Calendar:** month view, plus a private calendar link for Apple / Google Calendar.
- **Employees:** permanent and temporary staff with their details, designations, due increments.
- **File register:** physical files and e-files with their numbers.
- **Import / Export:** a master backup of everything, and CSV import/export (with sample files) for the file register, employees, tasks and reminders.
- **Phone notifications**, dark mode, offline viewing, and Malayalam everywhere.

**Gmail is only changed in the ways you approved (2026-10-06):** opening an email in WorkDesk's viewer marks that conversation read, and you can create / rename / recolour / delete your own labels (Settings → Mail) and add or remove them on an email (viewer → Labels, Remove → Send to a section). System labels (Inbox, Trash, Spam, Unread…) can't be touched through the label tools. WorkDesk asks for `gmail.modify`; the code has no way to delete or trash emails, archive, or send anything, and `tests/gmail-safety.test.ts` fails if any such code is added. Removing an email, completing a task and importing data never touch Gmail.

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
| `npm test` | Unit tests, including the Gmail safety check |
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

**What's stored:** for each email, only the subject, sender, Gmail snippet, dates, and IDs. Message bodies are never stored. Refresh tokens and the notification key are encrypted with AES-GCM.

## Version number

The small grey number next to "WorkDesk" (e.g. **v1.14**) is worked out from git when the dashboard is built (`vite.config.ts`):

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
