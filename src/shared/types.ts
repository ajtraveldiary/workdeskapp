// Shapes exchanged between the API and the dashboard.

export type EmailState = "needs_decision" | "task" | "snoozed" | "dismissed";
export type Priority = "low" | "normal" | "high" | "urgent";
export type TaskView = "today" | "upcoming" | "overdue" | "nodate" | "all" | "completed" | "any";
// Tasks due between two dates (inclusive), open and done.
export type RangeTasks = { from: string; to: string; today: string; tasks: Task[] };

export type Category = { id: string; name: string; sortOrder: number };

export type Thread = {
  id: string;
  gmailThreadId: string;
  accountEmail: string | null;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  snippet: string;
  lastMessageAt: string;
  messageCount: number;
  unread: boolean;
  state: EmailState;
  snoozedUntil: string | null;
  hasNewActivity: boolean;
  categoryId: string | null;
  stateChangedAt: string;
};

export type Task = {
  id: string;
  title: string;
  notes: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  status: "open" | "done";
  categoryId: string | null;
  completedAt: string | null;
  createdAt: string;
  thread: Pick<
    Thread,
    "id" | "gmailThreadId" | "accountEmail" | "subject" | "fromName" | "fromEmail" | "hasNewActivity"
  > | null;
};

export type AuditEvent = {
  id: string;
  entityType: "email" | "task" | "report" | "sync";
  entityId: string | null;
  action: string;
  summary: string;
  detail: { subject?: string; title?: string } | null;
  createdAt: string;
  // Current state of the email, so a dismissal can be undone from History.
  emailState: EmailState | null;
};

export type Me = {
  email: string;
  name: string | null;
  title: string | null;
  picture: string | null;
  demo: boolean;
  today: string;
  timezone: string;
  account: { email: string; lastSyncAt: string | null; lastSyncError: string | null; pending: number } | null;
};

export type Summary = {
  today: string;
  counts: {
    pendingEmails: number;
    unreadPending: number;
    dueToday: number;
    overdue: number;
    dueTomorrow: number;
    newActivity: number;
    completedThisWeek: number;
    openTasks: number;
    upcoming: number;
    completedTotal: number;
  };
  overdue: Task[];
  dueToday: Task[];
  dueTomorrow: Task[];
  newActivity: Task[];
  pendingEmails: Thread[];
  recentlyCompleted: Task[];
};
