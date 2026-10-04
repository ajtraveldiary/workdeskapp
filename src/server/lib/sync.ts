import { and, eq, inArray, lte, sql, count } from "drizzle-orm";
import type { DB } from "../db";
import { emailThreads, events, gmailAccounts, tasks } from "../db/schema";
import type { Env } from "../env";
import { requireEnv } from "../env";
import { decryptSecret } from "./crypto";
import {
  GmailError,
  getProfile,
  getThread,
  header,
  listHistory,
  listMessages,
  parseFrom,
  refreshAccessToken,
  type GmailMessage,
} from "./gmail";
import { onThreadUpdate } from "./threadRules";

type Account = typeof gmailAccounts.$inferSelect;
type EventRow = typeof events.$inferInsert;

export type ThreadSnapshot = {
  gmailThreadId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  snippet: string;
  lastMessageAt: Date;
  messageCount: number;
  unread: boolean;
  inInbox: boolean;
};

export function snapshotFromGmail(threadId: string, messages: GmailMessage[]): ThreadSnapshot | null {
  if (messages.length === 0) return null;
  const sorted = [...messages].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  const inbox = sorted.filter((m) => m.labelIds?.includes("INBOX"));
  const latest = inbox.at(-1) ?? sorted.at(-1)!;
  const from = parseFrom(header(latest, "From"));
  return {
    gmailThreadId: threadId,
    subject: header(sorted[0]!, "Subject") || "(no subject)",
    fromName: from.name,
    fromEmail: from.email,
    snippet: decodeEntities(latest.snippet ?? ""),
    lastMessageAt: new Date(Number(latest.internalDate ?? Date.now())),
    messageCount: sorted.length,
    unread: sorted.some((m) => m.labelIds?.includes("UNREAD")),
    inInbox: inbox.length > 0,
  };
}

function decodeEntities(s: string) {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Writes Gmail snapshots into the queue, applying the state rules. Never touches Gmail.
export async function applySnapshots(db: DB, userId: string, accountId: string | null, snaps: ThreadSnapshot[]) {
  if (snaps.length === 0) return;
  const ids = snaps.map((s) => s.gmailThreadId);
  const existing = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.gmailThreadId, ids)));
  const byGmailId = new Map(existing.map((t) => [t.gmailThreadId, t]));

  const taskThreadIds = existing.filter((t) => t.state === "task").map((t) => t.id);
  const openCounts = new Map<string, number>();
  if (taskThreadIds.length) {
    const rows = await db
      .select({ threadId: tasks.threadId, n: count() })
      .from(tasks)
      .where(and(inArray(tasks.threadId, taskThreadIds), eq(tasks.status, "open")))
      .groupBy(tasks.threadId);
    for (const r of rows) if (r.threadId) openCounts.set(r.threadId, r.n);
  }

  const now = new Date();
  const rows: (typeof emailThreads.$inferInsert)[] = [];
  const log: EventRow[] = [];
  for (const s of snaps) {
    const prev = byGmailId.get(s.gmailThreadId);
    if (!prev && !s.inInbox) continue; // only track conversations that reached the inbox
    const d = onThreadUpdate(prev, s.lastMessageAt, prev ? (openCounts.get(prev.id) ?? 0) : 0);
    const stateChanged = !prev || d.state !== prev.state;
    rows.push({
      userId,
      accountId,
      gmailThreadId: s.gmailThreadId,
      subject: s.subject,
      fromName: s.fromName,
      fromEmail: s.fromEmail,
      snippet: s.snippet,
      lastMessageAt: s.lastMessageAt,
      messageCount: s.messageCount,
      unread: s.unread,
      state: d.state,
      hasNewActivity: d.hasNewActivity,
      snoozedUntil: d.state === "snoozed" ? prev?.snoozedUntil : null,
      stateChangedAt: stateChanged ? now : prev!.stateChangedAt,
      updatedAt: now,
    });
    if (d.event && prev) {
      log.push({ userId, entityType: "email", entityId: prev.id, ...d.event, detail: { subject: s.subject } });
    }
  }
  if (rows.length === 0) return;

  const ex = (col: string) => sql.raw(`excluded.${col}`);
  await db
    .insert(emailThreads)
    .values(rows)
    .onConflictDoUpdate({
      target: [emailThreads.userId, emailThreads.gmailThreadId],
      set: {
        subject: ex("subject"),
        fromName: ex("from_name"),
        fromEmail: ex("from_email"),
        snippet: ex("snippet"),
        lastMessageAt: ex("last_message_at"),
        messageCount: ex("message_count"),
        unread: ex("unread"),
        state: ex("state"),
        hasNewActivity: ex("has_new_activity"),
        snoozedUntil: ex("snoozed_until"),
        stateChangedAt: ex("state_changed_at"),
        updatedAt: ex("updated_at"),
      },
    });
  if (log.length) await db.insert(events).values(log);
}

// Snoozed emails whose time has come go back into the queue.
export async function wakeSnoozed(db: DB, userId?: string) {
  const woken = await db
    .update(emailThreads)
    .set({ state: "needs_decision", snoozedUntil: null, stateChangedAt: new Date() })
    .where(
      and(
        eq(emailThreads.state, "snoozed"),
        lte(emailThreads.snoozedUntil, new Date()),
        userId ? eq(emailThreads.userId, userId) : undefined,
      ),
    )
    .returning({ id: emailThreads.id, userId: emailThreads.userId, subject: emailThreads.subject });
  if (woken.length) {
    await db.insert(events).values(
      woken.map((t) => ({
        userId: t.userId,
        entityType: "email" as const,
        entityId: t.id,
        action: "email.unsnoozed",
        summary: "Snooze ended; returned to queue",
        detail: { subject: t.subject },
      })),
    );
  }
}

export type SyncResult = { fetched: number; remaining: number };

export async function syncAccount(db: DB, env: Env, account: Account, retried = false): Promise<SyncResult> {
  if (!account.refreshTokenEnc) throw new Error("Gmail account is not connected");
  const refreshToken = await decryptSecret(account.refreshTokenEnc, requireEnv(env, "TOKEN_ENC_KEY"));
  const { access_token: token } = await refreshAccessToken(
    requireEnv(env, "GOOGLE_CLIENT_ID"),
    requireEnv(env, "GOOGLE_CLIENT_SECRET"),
    refreshToken,
  );

  const pending = new Set(account.pendingThreadIds);
  let historyId = account.historyId;

  if (!historyId) {
    // First sync: recent inbox conversations.
    const profile = await getProfile(token);
    const days = Number(env.SYNC_INITIAL_DAYS || 30);
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await listMessages(token, `in:inbox newer_than:${days}d`, pageToken);
      for (const m of r.messages ?? []) pending.add(m.threadId);
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    historyId = profile.historyId;
  } else {
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const r = await listHistory(token, historyId, pageToken);
        for (const h of r.history ?? []) for (const m of h.messages ?? []) pending.add(m.threadId);
        historyId = r.historyId;
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
    } catch (e) {
      // Gmail keeps history for about a week; if ours is too old, start over.
      if (e instanceof GmailError && e.status === 404 && !retried) {
        await db.update(gmailAccounts).set({ historyId: null }).where(eq(gmailAccounts.id, account.id));
        return syncAccount(db, env, { ...account, historyId: null }, true);
      }
      throw e;
    }
  }

  const all = [...pending];
  const batch = all.slice(0, Number(env.SYNC_BATCH || 30));
  const snaps: ThreadSnapshot[] = [];
  for (let i = 0; i < batch.length; i += 10) {
    const chunk = await Promise.all(
      batch.slice(i, i + 10).map((id) =>
        getThread(token, id).catch((e) => {
          if (e instanceof GmailError && e.status === 404) return null; // deleted in Gmail by the user
          throw e;
        }),
      ),
    );
    for (const t of chunk) {
      const s = t && snapshotFromGmail(t.id, t.messages ?? []);
      if (s) snaps.push(s);
    }
  }
  await applySnapshots(db, account.userId, account.id, snaps);

  const remaining = all.slice(batch.length);
  await db
    .update(gmailAccounts)
    .set({ historyId, pendingThreadIds: remaining, lastSyncAt: new Date(), lastSyncError: null })
    .where(eq(gmailAccounts.id, account.id));
  return { fetched: batch.length, remaining: remaining.length };
}

export async function syncUser(db: DB, env: Env, userId: string): Promise<SyncResult> {
  await wakeSnoozed(db, userId);
  const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  const total: SyncResult = { fetched: 0, remaining: 0 };
  for (const a of accounts) {
    if (!a.refreshTokenEnc) continue;
    try {
      const r = await syncAccount(db, env, a);
      total.fetched += r.fetched;
      total.remaining += r.remaining;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(gmailAccounts).set({ lastSyncError: msg.slice(0, 500) }).where(eq(gmailAccounts.id, a.id));
      throw e;
    }
  }
  return total;
}

// Cron entry point: every user, errors recorded per account rather than aborting the run.
export async function scheduledSync(db: DB, env: Env) {
  await wakeSnoozed(db);
  const accounts = await db.select().from(gmailAccounts);
  for (const a of accounts) {
    if (!a.refreshTokenEnc) continue;
    try {
      await syncAccount(db, env, a);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(gmailAccounts).set({ lastSyncError: msg.slice(0, 500) }).where(eq(gmailAccounts.id, a.id));
    }
  }
}
