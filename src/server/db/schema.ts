import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, boolean, date, jsonb, numeric, uniqueIndex, index, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import { REPEATS } from "../../shared/reminderSchedule";
import { RELATED_KINDS } from "../../shared/staff";
import { EVENT_KINDS, type EventChange } from "../../shared/eventSchedule";
import { MOVE_KINDS } from "../../shared/moves";
import { JOB_KINDS, JOB_STATUSES } from "../../shared/jobs";
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
  // Which employee the user is (Settings > Employees, user request 2026-10-12).
  employeeId: uuid("employee_id").references((): AnyPgColumn => employees.id, { onDelete: "set null" }),
  // Assistants (MCP Phase 3, user request 2026-10-18): may connected assistants change things, and at most how many
  // changes an hour. Off until the user switches it on in Settings › Assistant.
  assistantChanges: boolean("assistant_changes").notNull().default(false),
  assistantPerHour: integer("assistant_per_hour").notNull().default(30),
  // Phase 4: staff actions (join, relieve, increments, contracts, probation, employee details) by assistants, a switch
  // of its own that also needs assistantChanges. Off until switched on.
  assistantStaff: boolean("assistant_staff").notNull().default(false),
  // Phase 5: when the user last looked at the assistant's changes (the bell shows changes made after it).
  assistantSeenAt: timestamp("assistant_seen_at", { withTimezone: true }),
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
// "event": made into an event (Events page, user request 2026-10-11); a new reply brings it back to Pending.
export const EMAIL_STATES = ["needs_decision", "task", "snoozed", "dismissed", "elsewhere", "event"] as const;
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

// Types of events (user request 2026-10-12, "add, edit or delete event types in Settings"): Meeting, Training,
// Programme… in this order. Replaces the fixed `kind`; deleting a type leaves its events without one ("Event").
export const eventTypes = pgTable("event_types", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

// Events: meetings, trainings, programmes (user request 2026-10-11). Called office_events because `events` is
// the History audit trail. Repeats like reminders (REPEATS, dueDay); each occurrence's done / cancelled / moved is
// kept in `changes`, keyed by its scheduled day. prepDays: a "Prepare" task due that many days before each
// occurrence (null = none). notifiedFor: the "day time" of the last occurrence a phone note went out for.
export const officeEvents = pgTable("office_events", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  // The first fixed kinds (2026-10-11); kept for old rows, no longer used (the type is typeId since 2026-10-12).
  kind: text("kind", { enum: EVENT_KINDS }).notNull().default("meeting"),
  typeId: uuid("type_id").references(() => eventTypes.id, { onDelete: "set null" }),
  startDate: date("start_date").notNull(),
  // Day of the month for monthly and longer repeats (as reminders).
  dueDay: integer("due_day").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  repeat: text("repeat", { enum: REPEATS }).notNull().default("never"),
  endDate: date("end_date"),
  venue: text("venue").notNull().default(""),
  meetingUrl: text("meeting_url").notNull().default(""),
  organiser: text("organiser").notNull().default(""),
  // Who attends, from the Employees list.
  attendeeIds: uuid("attendee_ids").array().notNull().default(sql`'{}'::uuid[]`),
  notes: text("notes").notNull().default(""),
  links: jsonb("links").$type<ReminderLink[]>().notNull().default([]),
  // Tags were taken off events (user request 2026-10-12); kept for old rows, no longer used.
  tagIds: uuid("tag_ids").array().notNull().default(sql`'{}'::uuid[]`),
  // The email it was made from ("Make event").
  threadId: uuid("thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
  prepDays: integer("prep_days"),
  changes: jsonb("changes").$type<EventChange[]>().notNull().default([]),
  notifiedFor: text("notified_for"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
    // WorkDesk-only tags (user request 2026-10-11; `tags`). A reminder's task gets the reminder's tags.
    tagIds: uuid("tag_ids").array().notNull().default(sql`'{}'::uuid[]`),
    threadId: uuid("thread_id").references(() => emailThreads.id),
    // Set when the task was generated for a recurring report's period.
    reportPeriodId: uuid("report_period_id").references(() => reportPeriods.id, { onDelete: "set null" }),
    // A "Prepare" task for one occurrence of an event (user request 2026-10-11): the event and its scheduled day.
    eventId: uuid("event_id").references(() => officeEvents.id, { onDelete: "set null" }),
    eventDate: date("event_date"),
    // Steps inside the task, ticked one by one (user request 2026-10-07, v2 idea 4).
    checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
    // Links kept with the task (user request 2026-10-19): web addresses with an optional name, as reminders have.
    links: jsonb("links").$type<ReminderLink[]>().notNull().default([]),
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
    // Made by WorkDesk itself, not by hand, an email or a reminder (user request 2026-10-08): e.g. the Pension
    // papers task 12 months before retirement. Task details label it "Made by system".
    madeBySystem: boolean("made_by_system").notNull().default(false),
    // Which kind of system task (user request 2026-10-08): "pension" (Pension papers), "contract" (a temporary
    // employee's contract ending: ticking it asks Renew or Contract ended) or "probation" (probation declaration
    // pending: ticking it asks Declared or Change due date). Null for every other task.
    systemKind: text("system_kind", { enum: ["pension", "contract", "probation", "joining", "relieving"] }),
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
  // WorkDesk-only tags (user request 2026-10-11), copied to each occurrence's task.
  tagIds: uuid("tag_ids").array().notNull().default(sql`'{}'::uuid[]`),
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

// Types of temporary employees (user request 2026-10-07): HMC, NHM, Block Panchayath Project… Edited in
// Settings > Employees, in this order.
export const employeeTypes = pgTable("employee_types", {
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
  // Permanent or temporary (user request 2026-10-07). Temporary staff have no increment, retirement or
  // probation dates (cleared on save) and may have an "engaged till" date instead.
  permanent: boolean("permanent").notNull().default(true),
  // Contract end date for temporary ones.
  engagedTill: date("engaged_till"),
  // Temporary ones only (user request 2026-10-07): contract / daily_wage / temporary ("" = not given), their
  // type, the contract period in days and the pay per day in rupees. Date of joining is joined_service_on.
  engagement: text("engagement").notNull().default(""),
  typeId: uuid("type_id").references(() => employeeTypes.id),
  contractDays: integer("contract_days"),
  payPerDay: numeric("pay_per_day", { precision: 10, scale: 2, mode: "number" }),
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
  // Basic pay in rupees, permanent staff only (user request 2026-10-08): shown in the Employees table and asked
  // for again when an increment is marked done.
  basicPay: numeric("basic_pay", { precision: 10, scale: 2, mode: "number" }),
  probationDeclaredOn: date("probation_declared_on"),
  address: text("address").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // Left the office (transfer, retirement…): hidden from the pickers, kept for old tasks.
  leftOn: date("left_on"),
  // The "Pension papers" task WorkDesk made 12 months before retirement (user request 2026-10-08); set once,
  // so a task the user deletes isn't made again. No foreign key: the task may be deleted.
  pensionTaskId: uuid("pension_task_id"),
  // The "Contract ends" task for a temporary employee (user request 2026-10-08) and the end date it was made
  // for: a new end date (renewed or edited) gets its own task; the same one never gets a second.
  contractTaskId: uuid("contract_task_id"),
  contractTaskFor: date("contract_task_for"),
  // The "Probation" task made when 2 years of service are near and probation isn't declared (user request
  // 2026-10-08); set once, so a deleted task isn't made again.
  probationTaskId: uuid("probation_task_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Joining and relieving (user request 2026-10-15): one row per join or relieve of an employee, with the date and
// its task (whose checklist holds the steps, MOVE_STEPS in src/shared/moves.ts). Deleting the task removes the row.
export const employeeMoves = pgTable("employee_moves", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: MOVE_KINDS }).notNull(),
  onDate: date("on_date").notNull(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// Registers (user request 2026-10-16): the office's registers (service book register, stock register…), added in
// Settings › Registers. updatedUntil: the date the register is written up to, set by the user.
export const registers = pgTable("registers", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedUntil: date("updated_until"),
  createdAt: createdAt(),
});

// A pending update to a register: what to write, and the employee who has to sign it or give what is needed
// (employeeId). Not a task unless given a due date: then taskId is its task, kept in step both ways (done ↔
// completed). Done entries are kept (doneAt).
export const registerEntries = pgTable(
  "register_entries",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    registerId: uuid("register_id")
      .notNull()
      .references(() => registers.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("register_entries_user").on(t.userId, t.status)],
);

// More emails on a task or an event (user request 2026-10-17): added from Task details / Event details out of
// Pending. Each behaves like the main email (tasks.threadId / office_events.threadId): it leaves Pending (state task
// or event), gets the task/done labels in Gmail with its task, and a new reply flags the task (lib/linkedEmails.ts).
export const linkedEmails = pgTable(
  "linked_emails",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => officeEvents.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("linked_emails_task").on(t.taskId, t.threadId), uniqueIndex("linked_emails_event").on(t.eventId, t.threadId), index("linked_emails_thread").on(t.threadId)],
);

// File register (user request 2026-10-07): the office's files, old physical ones (they have no number) and
// e-files. A physical file with no e-file number is "e-file not yet created".
export const officeFiles = pgTable("office_files", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  // The file's name, or the e-file's subject.
  subject: text("subject").notNull(),
  physical: boolean("physical").notNull().default(true),
  efileNumber: text("efile_number").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // The same WorkDesk tags as tasks and reminders (user request 2026-10-11).
  tagIds: uuid("tag_ids").array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Tags for tasks and reminders (user request 2026-10-11): made once, reused anywhere. WorkDesk-only (not Gmail
// labels). The name is unique per user whatever its capitals; colour is a TAG_COLORS name (src/shared/tags.ts).
export const tags = pgTable(
  "tags",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    color: text("color").notNull().default("blue"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_user_name").on(t.userId, sql`lower(${t.name})`)],
);

// Saved logins for office websites (user request 2026-10-11), e.g. SPARK (one login per employee) or BiMS (shared
// DDO / section clerk logins). One website can have many logins. The password is AES-GCM encrypted with
// TOKEN_ENC_KEY and is only ever sent to the browser when the user taps Show or Copy (POST /logins/:id/reveal).
export const siteLogins = pgTable("site_logins", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  website: text("website").notNull(),
  url: text("url").notNull().default(""),
  // Who uses it: an employee from the Employees list, or a role / name typed in (DDO, Section clerk).
  employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
  // The role / name typed in; for an employee, their name when saved (still shown if they are deleted later).
  assignedTo: text("assigned_to").notNull().default(""),
  loginId: text("login_id").notNull().default(""),
  passwordEnc: text("password_enc"),
  remarks: text("remarks").notNull().default(""),
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

// --- Assistants (MCP server, user request 2026-10-18; docs/MCP_PLAN.md) ---

// An assistant app that signs in to WorkDesk: one that registered itself (ChatGPT, Gemini) or one known by the
// https address of its metadata document (Client ID Metadata Documents).
export const mcpClients = pgTable("mcp_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  redirectUris: text("redirect_uris").array().notNull().default(sql`'{}'::text[]`),
  kind: text("kind", { enum: ["registered", "metadata"] }).notNull(),
  createdAt: createdAt(),
});

// A sign-in code waiting to be swapped for tokens (10 minutes, once). Stored hashed.
export const mcpCodes = pgTable("mcp_codes", {
  id: id(),
  codeHash: text("code_hash").notNull().unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => mcpClients.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull().default("workdesk"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// Access tokens (1 hour) and refresh tokens (60 days, replaced on every use) of a connected assistant. Stored
// hashed; Disconnect in Settings › Assistant deletes them.
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpClients.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scope: text("scope").notNull().default("workdesk"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("mcp_tokens_user").on(t.userId, t.clientId)],
);

// The assistant log (user's choice 2026-10-18: separate from History): every tool call an assistant made, with its
// arguments and whether it worked. Kept for a year.
export const assistantLog = pgTable(
  "assistant_log",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    clientId: text("client_id"),
    clientName: text("client_name").notNull().default(""),
    tool: text("tool").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull().default({}),
    ok: boolean("ok").notNull(),
    message: text("message").notNull().default(""),
    // A change (Phase 3) rather than a read, and what it changed (kind, id, title).
    change: boolean("change").notNull().default(false),
    touched: jsonb("touched").$type<{ kind: string; id: string; title: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("assistant_log_user").on(t.userId, t.createdAt)],
);

// Office details (user request 2026-10-19, Settings › General): letterhead, seat, signature block, file number
// pattern, usual recipients and office codes, used by assistants to draft complete letters. One row per user
// (its own table so the backup carries it); `data` follows officeProfileInput in src/shared/schemas.ts.
export const officeProfiles = pgTable("office_profiles", {
  id: id(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  data: jsonb("data").$type<import("../../shared/schemas").OfficeProfile>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Background queue (user request 2026-10-23, lib/queue.ts): one row per piece of background work (Gmail sync,
// phone notifications, task labels, upkeep). A run that runs out of calls leaves it queued, so it is never lost;
// failures are tried again with a wait and shown in Settings › Queue. At most one queued or running job per kind.
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: JOB_KINDS }).notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    // Failed tries so far, and runs that ran out of calls before it finished (those don't count as failures).
    attempts: integer("attempts").notNull().default(0),
    pauses: integer("pauses").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Calls the last try used, what started that run (the 10-minute schedule or the app), and what happened.
    calls: integer("calls").notNull().default(0),
    ranBy: text("ran_by", { enum: ["schedule", "app"] }),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_active").on(t.userId, t.kind).where(sql`${t.status} in ('queued', 'running')`),
    index("jobs_user_created").on(t.userId, t.createdAt),
  ],
);
