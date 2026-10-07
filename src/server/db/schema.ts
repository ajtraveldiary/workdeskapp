import { sql } from "drizzle-orm";
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
import { REPEATS } from "../../shared/reminderSchedule";
import { RELATED_KINDS } from "../../shared/staff";
import type { ChecklistItem, ReminderLink } from "../../shared/types";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// Single-user today, but every row carries user_id so more users can be added later.
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  // Settings > Mail: Gmail label put on emails that become tasks, and the one for completed tasks.
  // Choosing one also turns every email that already has it into a task (open / completed).
  taskLabelId: text("task_label_id"),
  doneLabelId: text("done_label_id"),
  // More labels whose emails become completed tasks straight away, like the done label (user request 2026-10-06).
  autoDoneLabelIds: text("auto_done_label_ids").array().notNull().default(sql`'{}'::text[]`),
  // Labels only for organising mail (user request 2026-10-07): every other label besides the task/done labels
  // marks another section of the office (emails with it skip Pending, see lib/sections.ts). Replaces the
  // "straight to completed" tick boxes; autoDoneLabelIds is no longer used.
  organizeLabelIds: text("organize_label_ids").array().notNull().default(sql`'{}'::text[]`),
  // Secret part of the private calendar link (tasks and reminders for Apple Calendar etc., user request
  // 2026-10-07). Null = no link; a new value stops the old link working.
  calendarToken: text("calendar_token").unique(),
  // Phone notifications (user request 2026-10-07): the key pair WorkDesk signs its notifications with (made on
  // first use; the private half encrypted with TOKEN_ENC_KEY), and what to send. The settings apply to every
  // device the user turned notifications on for (push_subscriptions).
  vapidPublicKey: text("vapid_public_key"),
  vapidPrivateKeyEnc: text("vapid_private_key_enc"),
  pushSummaryOn: boolean("push_summary_on").notNull().default(true),
  pushSummaryTime: text("push_summary_time").notNull().default("09:30"),
  pushSummarySentOn: date("push_summary_sent_on"),
  pushDueOn: boolean("push_due_on").notNull().default(true),
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
  // When the label list was last read from Gmail, and whether stored conversations got their labels.
  labelsSyncedAt: timestamp("labels_synced_at", { withTimezone: true }),
  labelsBackfilledAt: timestamp("labels_backfilled_at", { withTimezone: true }),
  // Last label handled by that one-time backfill, which runs a few labels per sync.
  labelsBackfillCursor: text("labels_backfill_cursor"),
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

// The user's own Gmail labels, as last read from Gmail (demo mode keeps them here only).
export const gmailLabels = pgTable(
  "gmail_labels",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    gmailLabelId: text("gmail_label_id").notNull(),
    name: text("name").notNull(),
    backgroundColor: text("background_color"),
    textColor: text("text_color"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gmailLabelId] })],
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

// Settings > Mail > Hidden text (user request 2026-10-06): repeated text such as signatures and disclaimers,
// left out of the email reader and of shared emails. Only WorkDesk's view changes; Gmail is untouched.
export const hiddenSnippets = pgTable(
  "hidden_snippets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("hidden_snippets_user").on(t.userId)],
);

// "elsewhere": handled by another section of the office, i.e. the email carries a label other than the user's
// task/done labels and their organising labels (user request 2026-10-07).
export const EMAIL_STATES = ["needs_decision", "task", "snoozed", "dismissed", "elsewhere"] as const;
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
    // The user's own Gmail labels on this conversation (IDs like "Label_12"); system labels aren't kept.
    labelIds: text("label_ids").array().notNull().default(sql`'{}'::text[]`),
    // The section (label) the email went to "Other sections" with; kept when a new reply brings it back to
    // Pending, which shows "Back from …" and stops it moving away again.
    sectionLabelId: text("section_label_id"),
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
    // The user's Gmail labels on a task that has no email (made by hand or for a report), kept in WorkDesk only.
    // A task from an email uses its email's labels instead (email_threads.label_ids), so this stays empty.
    labelIds: text("label_ids").array().notNull().default(sql`'{}'::text[]`),
    threadId: uuid("thread_id").references(() => emailThreads.id),
    // Set when the task was generated for a recurring report's period.
    reportPeriodId: uuid("report_period_id").references(() => reportPeriods.id, { onDelete: "set null" }),
    // Steps inside the task, ticked one by one (user request 2026-10-07, v2 idea 4).
    checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
    // Waiting for a reply (user request 2026-10-07): set while the task waits on someone else; it then leaves
    // the to-do lists for the Waiting tab and comes back (Today / Overdue) on replyBy, the optional date a
    // reply is expected by. Waiting tasks stay status "open"; completing one clears both.
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
    replyBy: date("reply_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // What the task is about (user request 2026-10-07, Staff): an employee, a designation (all staff of that
    // kind) or the general office; null = nothing chosen. related_id is the employee / designation id.
    relatedKind: text("related_kind", { enum: RELATED_KINDS }),
    relatedId: uuid("related_id"),
    // "YYYY-MM-DD HH:MM" the phone was last notified for (at the due time); a new date or time notifies again.
    pushNotifiedFor: text("push_notified_for"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_user_status_due").on(t.userId, t.status, t.dueDate)],
);

// Audit trail, kept separate from Gmail's own history.
// Legacy report frequencies (before reminders); kept so the old columns still describe old rows.
export const FREQUENCIES = ["monthly", "quarterly", "half_yearly", "annual"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

// A reminder (shown as "Reminders"; stored as "reports", user request 2026-10-06): monthly reports, meetings,
// payment due dates... Each occurrence gets a row in report_periods and its own task.
export const reports = pgTable("reports", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  repeat: text("repeat", { enum: REPEATS }).notNull().default("never"),
  // The first occurrence.
  startDate: date("start_date").notNull(),
  // Optional time of day, "HH:MM" (24h) in the app timezone; copied to each task.
  dueTime: text("due_time"),
  // No occurrences after this day (null = repeats forever).
  endDate: date("end_date"),
  // Day of the month for monthly and longer repeats (31 = last day of the month).
  dueDay: integer("due_day").notNull(),
  // The occurrence's task appears this many days before it is due ("Remind me").
  leadDays: integer("lead_days").notNull().default(0),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
  // Links to Google Drive files, Sheets, Docs… needed for the reminder (user request 2026-10-07).
  links: jsonb("links").$type<ReminderLink[]>().notNull().default([]),
  // What the reminder is about (Staff, user request 2026-10-07); copied to its tasks.
  relatedKind: text("related_kind", { enum: RELATED_KINDS }),
  relatedId: uuid("related_id"),
  // No longer set from the app (reminders have no labels, user request 2026-10-06); old values are ignored.
  labelIds: text("label_ids").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  // Legacy report fields, no longer used: the period rule old reports were converted from, and "responsible".
  responsible: text("responsible"),
  frequency: text("frequency", { enum: FREQUENCIES }),
  dueMonthOffset: integer("due_month_offset"),
  yearStartMonth: integer("year_start_month"),
  firstPeriodStart: date("first_period_start"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One row per occurrence of a reminder (old rows: per reporting period), so each one is tracked on its own.
// New occurrences have periodStart = periodEnd = dueDate; status "submitted" means done.
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

// The office's staff (user request 2026-10-07, Staff page): designations (posts such as Senior Clerk, Staff
// Nurse) and employees. Tasks and reminders can be about one employee, one designation or the general office.
export const designations = pgTable("designations", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const employees = pgTable("employees", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  designationId: uuid("designation_id").references(() => designations.id),
  pen: text("pen").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  dateOfBirth: date("date_of_birth"),
  // General, OBC, OEC, SC, ST, EWS or Other ("" = not given).
  category: text("category").notNull().default(""),
  joinedServiceOn: date("joined_service_on"),
  joinedOfficeOn: date("joined_office_on"),
  nextIncrementOn: date("next_increment_on"),
  retiresOn: date("retires_on"),
  payScale: text("pay_scale").notNull().default(""),
  probationDeclaredOn: date("probation_declared_on"),
  address: text("address").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // Left the office (transfer, retirement…): hidden from the pickers, kept for old tasks.
  leftOn: date("left_on"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Devices that turned on phone notifications (user request 2026-10-07): one Web Push subscription each.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  device: text("device"),
  createdAt: createdAt(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
});

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
