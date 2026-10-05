import { and, eq, lt } from "drizzle-orm";
import type { DB } from "../db";
import { categories, reportPeriods, reports, users } from "../db/schema";
import { applySnapshots, type ThreadSnapshot } from "./sync";
import { ensureReportPeriods, setPeriodStatus } from "./reports";

// Examples from the plan; editable on the Settings screen.
const DEFAULT_CATEGORIES = ["Establishment", "Accounts", "NHM", "HMC", "Pharmacy", "General Administration"];

export async function ensureUser(db: DB, email: string, name?: string | null) {
  const [found] = await db.select().from(users).where(eq(users.email, email));
  if (found) return { user: found, created: false };
  const [user] = await db.insert(users).values({ email, name: name ?? null }).returning();
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((n, i) => ({ userId: user!.id, name: n, sortOrder: i })));
  return { user: user!, created: true };
}

// --- Demo mailbox for local development without Google credentials ---

const DEMO_EMAILS: Omit<ThreadSnapshot, "gmailThreadId" | "lastMessageAt" | "inInbox">[] = [
  {
    subject: "Submission of Monthly Expenditure Statement",
    fromName: "District Office",
    fromEmail: "district.office@example.gov",
    snippet: "Kindly submit the monthly expenditure statement for September by the 5th of this month.",
    messageCount: 1,
    unread: true,
  },
  {
    subject: "HMIS data entry: September reporting",
    fromName: "HMIS Cell",
    fromEmail: "hmis@example.gov",
    snippet: "All facilities are requested to complete HMIS entry for September before the deadline.",
    messageCount: 2,
    unread: true,
  },
  {
    subject: "Leave application – staff nurse",
    fromName: "Ward In-charge",
    fromEmail: "ward.incharge@example.org",
    snippet: "Forwarding the leave application for approval. Please process at the earliest.",
    messageCount: 1,
    unread: false,
  },
  {
    subject: "Pharmacy indent for October",
    fromName: "Pharmacist",
    fromEmail: "pharmacy@example.org",
    snippet: "Attached is the indent of medicines required for October. Kindly forward to the store.",
    messageCount: 1,
    unread: true,
  },
  {
    subject: "Newsletter: Health department updates",
    fromName: "State Health Society",
    fromEmail: "news@example.gov",
    snippet: "This month's highlights from across the state health programmes.",
    messageCount: 1,
    unread: false,
  },
  {
    subject: "HMC meeting minutes",
    fromName: "HMC Secretary",
    fromEmail: "hmc.secretary@example.org",
    snippet: "Please find the minutes of the last HMC meeting. Action points need follow-up.",
    messageCount: 3,
    unread: false,
  },
];

export async function seedDemoMailbox(db: DB, userId: string) {
  const now = Date.now();
  await applySnapshots(
    db,
    userId,
    null,
    DEMO_EMAILS.map((e, i) => ({
      ...e,
      gmailThreadId: `demo-${i}`,
      lastMessageAt: new Date(now - i * 7 * 3600_000),
      inInbox: true,
    })),
  );
}

// "Sync" in demo mode: a new email arrives in one demo conversation, to exercise the state rules.
export async function demoArrival(db: DB, userId: string) {
  const i = Math.floor(Math.random() * DEMO_EMAILS.length);
  const e = DEMO_EMAILS[i]!;
  await applySnapshots(db, userId, null, [
    {
      ...e,
      gmailThreadId: `demo-${i}`,
      snippet: `Reminder: ${e.snippet}`,
      lastMessageAt: new Date(),
      messageCount: e.messageCount + 1,
      unread: true,
      inInbox: true,
    },
  ]);
}

// Sample reporting duties (from the WorkDesk plan; illustrative, not a verified list of obligations).
// Periods already past their due date are marked submitted so the demo starts with some history.
export async function seedDemoReports(db: DB, userId: string, today: string) {
  const back = (months: number) => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.toISOString().slice(0, 10);
  };
  await db.insert(reports).values([
    { userId, name: "Monthly expenditure statement", frequency: "monthly", dueDay: 5, dueMonthOffset: 1, leadDays: 7, priority: "high", responsible: "Accounts section", firstPeriodStart: back(4) },
    { userId, name: "Monthly HMIS report", frequency: "monthly", dueDay: 10, dueMonthOffset: 1, leadDays: 7, priority: "high", firstPeriodStart: back(3) },
    { userId, name: "NHM quarterly progress report", frequency: "quarterly", dueDay: 15, dueMonthOffset: 1, yearStartMonth: 4, leadDays: 14, priority: "normal", firstPeriodStart: back(6) },
    { userId, name: "Annual administrative report", frequency: "annual", dueDay: 30, dueMonthOffset: 3, yearStartMonth: 4, leadDays: 30, priority: "normal", firstPeriodStart: back(18) },
  ]);
  await ensureReportPeriods(db, today, userId);
  const past = await db
    .select({ id: reportPeriods.id })
    .from(reportPeriods)
    .where(and(eq(reportPeriods.userId, userId), lt(reportPeriods.dueDate, today)));
  for (const p of past) await setPeriodStatus(db, userId, p.id, "submitted");
}
