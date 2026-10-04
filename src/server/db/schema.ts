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
  historyId: text("history_id"),
  // Gmail threads seen as changed but not fetched yet; drained a batch at a time.
  pendingThreadIds: jsonb("pending_thread_ids").$type<string[]>().notNull().default([]),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: createdAt(),
});

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
    priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    threadId: uuid("thread_id").references(() => emailThreads.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_user_status_due").on(t.userId, t.status, t.dueDate)],
);

// Audit trail, kept separate from Gmail's own history.
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
