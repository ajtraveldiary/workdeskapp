import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { categories, users } from "../db/schema";
import { applySnapshots, type ThreadSnapshot } from "./sync";

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
