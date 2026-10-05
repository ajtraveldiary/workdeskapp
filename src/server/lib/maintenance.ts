import type { DB } from "../db";
import { ensureReportPeriods } from "./reports";
import { wakeSnoozed } from "./sync";

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
}
