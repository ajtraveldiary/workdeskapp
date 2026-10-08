import type { DB } from "../db";
import { ensureReportPeriods } from "./reports";
import { wakeSnoozed } from "./sync";
import { applySectionRules } from "./sections";
import { ensurePensionTasks } from "./pension";
import { ensureContractTasks } from "./contracts";
import { ensureProbationTasks } from "./probation";

// Housekeeping that read endpoints used to run on every request (waking snoozed emails, creating report
// periods). It now runs at most once per INTERVAL per user from page loads, which saves database round trips.
// The cron job runs it every 10 minutes regardless, and a manual refresh forces it.
const INTERVAL = 5 * 60_000;
const lastRun = new Map<string, number>(); // per server instance; best effort

export async function maintain(db: DB, userId: string, today: string, force = false) {
  const now = Date.now();
  if (!force && now - (lastRun.get(userId) ?? 0) < INTERVAL) return;
  lastRun.set(userId, now);
  await wakeSnoozed(db, userId);
  await ensureReportPeriods(db, today, userId);
  // Emails already in Pending with another section's label move out too (user request 2026-10-07).
  await applySectionRules(db, userId);
  // Pension papers tasks for employees retiring within 12 months (user request 2026-10-08).
  await ensurePensionTasks(db, today, userId);
  // Contract ends tasks from 7 days before a temporary contract ends (user request 2026-10-08).
  await ensureContractTasks(db, today, userId);
  // Probation declaration tasks near 2 years of service (user request 2026-10-08).
  await ensureProbationTasks(db, today, userId);
}
