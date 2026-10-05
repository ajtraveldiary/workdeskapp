# WorkDesk

*Every email accounted for. Every task tracked.*

A personal dashboard on top of Gmail. Every email that comes in needs a decision: turn it into a task, snooze it, or dismiss it. Tasks keep a link back to their email, and a History screen records every decision.

**Gmail is never changed.** WorkDesk asks only for `gmail.readonly`, and the code has no way to delete, trash, archive, label, mark read, or send anything. `tests/gmail-safety.test.ts` fails if any such code is added.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. You don't need any accounts for this. With no `.env` file, WorkDesk:
- keeps its database in `./.data` (PGlite, an embedded Postgres), and
- signs you in as a demo user with sample emails. In demo mode, **Simulate new email** stands in for Sync.

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
4. Under **Data access**, add the scope `.../auth/gmail.readonly`.
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
One Worker serves both the dashboard and the API, and a cron trigger syncs Gmail every 10 minutes.

## How it fits together

```
src/
  client/          React dashboard (Home, Emails, Tasks, Reports, Calendar, History, Search, Settings)
  server/
    app.ts         Hono API, Google sign-in, session cookie
    worker.ts      Cloudflare entry (fetch + cron)
    dev.ts         Local Node entry
    db/schema.ts   Drizzle schema: users, gmail_accounts, email_threads, tasks, categories, events
    lib/gmail.ts   Read-only Gmail client (GET requests to an allowlist of read endpoints)
    lib/sync.ts    Incremental sync via Gmail history, in batches
    lib/threadRules.ts  What a new message does to a dismissed, snoozed, or converted email
    lib/reports.ts Creates each report period and its task ahead of the due date; keeps period and task in step
  shared/reportSchedule.ts  Period and due-date rules (shared with the browser for previews)
  shared/          Types and Zod schemas used by both sides
```

**Email states:** *needs decision*, *converted to task*, *snoozed*, or *dismissed*. These rules keep work from getting lost:
- If a new message arrives in a dismissed or snoozed conversation, it goes back to the queue.
- If a new message arrives in a conversation whose task is still open, the task is flagged "New reply".
- If a new message arrives after the task was completed, the conversation goes back to the queue.
- A dismissed email can be restored from History or from the Inbox's Dismissed tab.

**What's stored:** for each email, only the subject, sender, Gmail snippet, dates, and IDs. Message bodies are never stored. Refresh tokens are encrypted with AES-GCM.

## Roadmap
- [x] Phase 1: Gmail queue, Create task / Dismiss / Snooze / Open in Gmail
- [x] Phase 2: tasks with due dates, priorities, notes, categories, and completion history
- [x] Phase 3: recurring reports (monthly, quarterly, half-yearly, annual) with period-by-period tracking and a reporting calendar
- [~] Phase 4: Command Center (the Today screen exists; backup and reminders are still to do)
