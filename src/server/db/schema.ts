import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  date,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// Single-user today, but every row carries user_id so more users can be added later.
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  // Shown on the home screen profile card, e.g. "Clerk, District Hospital".
  title: text("title"),
  picture: text("picture"),
  createdAt: createdAt(),
});

export const gmailAccounts = pgTable("gmail_accounts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  email: text("email").notNull().unique(),
  // AES-GCM encrypted; never sent to the browser.
  refreshTokenEnc: text("refresh_token_enc"),
  // Scopes granted at the last sign-in (space separated), e.g. whether marking read is allowed.
  grantedScopes: text("granted_scopes"),
  historyId: text("history_id"),
  // Gmail threads seen as changed but not fetched yet; drained a batch at a time.
  pendingThreadIds: jsonb("pending_thread_ids").$type<string[]>().notNull().default([]),
  // New messages in already-stored conversations, as "threadId:messageId"; fetched one by one.
  pendingMessageIds: jsonb("pending_message_ids").$type<string[]>().notNull().default([]),
  // Next page of the first sync's 30-day listing; set while that backfill is still running.
  initialPageToken: text("initial_page_token"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: createdAt(),
});

// Every Gmail message WorkDesk has already downloaded (IDs only, no content), so none is fetched twice.
export const gmailMessages = pgTable(
  "gmail_messages",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.gmailMessageId] })],
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_user_name").on(t.userId, t.name)],
);

// Senders whose emails skip Pending (they still appear under All emails). A pattern is an exact
// address ("clerk@example.gov") or a whole domain ("@example.gov"), stored lowercase.
export const mutedSenders = pgTable(
  "muted_senders",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    pattern: text("pattern").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("muted_senders_user_pattern").on(t.userId, t.pattern)],
);

export const EMAIL_STATES = ["needs_decision", "task", "snoozed", "dismissed"] as const;
export type EmailState = (typeof EMAIL_STATES)[number];

// One row per Gmail conversation. We keep only what the queue needs (no message bodies).
export const emailThreads = pgTable(
  "email_threads",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").references(() => gmailAccounts.id),
    gmailThreadId: text("gmail_thread_id").notNull(),
    subject: text("subject").notNull().default(""),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    snippet: text("snippet").notNull().default(""),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").notNull().default(1),
    unread: boolean("unread").notNull().default(false),
    state: text("state", { enum: EMAIL_STATES }).notNull().default("needs_decision"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    // A new message arrived after the thread was turned into a task.
    hasNewActivity: boolean("has_new_activity").notNull().default(false),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("email_threads_user_thread").on(t.userId, t.gmailThreadId),
    index("email_threads_user_state").on(t.userId, t.state),
  ],
);

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    dueDate: date("due_date"),
    // Optional time of day, "HH:MM" (24h) in the app timezone.
    dueTime: text("due_time"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    threadId: uuid("thread_id").references(() => emailThreads.id),
    // Set when the task was generated for a recurring report's period.
    reportPeriodId: uuid("report_period_id").references(() => reportPeriods.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_user_status_due").on(t.userId, t.status, t.dueDate)],
);

// Audit trail, kept separate from Gmail's own history.
export const FREQUENCIES = ["monthly", "quarterly", "half_yearly", "annual"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

// A recurring reporting duty, e.g. "Monthly expenditure statement, due on the 5th of the following month".
export const reports = pgTable("reports", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  frequency: text("frequency", { enum: FREQUENCIES }).notNull(),
  // Day of the due month (31 = last day of the month).
  dueDay: integer("due_day").notNull(),
  // 0 = due in the period's last month, 1 = the month after the period ends, ...
  dueMonthOffset: integer("due_month_offset").notNull().default(1),
  // Quarters, halves and years start in this month (4 = April, the Indian financial year).
  yearStartMonth: integer("year_start_month").notNull().default(4),
  // The period's task appears this many days before it is due.
  leadDays: integer("lead_days").notNull().default(7),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("high"),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  responsible: text("responsible"),
  // Start of the first period to track.
  firstPeriodStart: date("first_period_start").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One row per reporting period, so each period's submission is tracked on its own.
export const reportPeriods = pgTable(
  "report_periods",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    label: text("label").notNull(),
    dueDate: date("due_date").notNull(),
    status: text("status", { enum: ["pending", "submitted"] }).notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("report_periods_report_start").on(t.reportId, t.periodStart), index("report_periods_user_due").on(t.userId, t.dueDate)],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    entityType: text("entity_type", { enum: ["email", "task", "report", "sync"] }).notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    summary: text("summary").notNull().default(""),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("events_user_created").on(t.userId, t.createdAt)],
);
