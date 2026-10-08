import { and, eq, inArray, lte, notInArray, sql, count } from "drizzle-orm";
import type { DB } from "../db";
import { emailThreads, events, gmailAccounts, gmailLabels, gmailMessages, tasks } from "../db/schema";
import type { Env } from "../env";
import { requireEnv, timezone } from "../env";
import { todayIn } from "./dates";
import { ensureReportPeriods } from "./reports";
import { ensurePensionTasks } from "./pension";
import { clearMissingTaskLabels, getTaskLabels, labelTaskEmails, runLabelRules, watchedLabels } from "./taskLabels";
import { applySectionRules } from "./sections";
import { decryptSecret } from "./crypto";
import {
  GmailError,
  getMessage,
  getProfile,
  isUserLabelId,
  listLabels,
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
  // The user's own labels on the conversation; omitted (e.g. demo) keeps whatever is stored.
  labelIds?: string[];
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
    labelIds: [...new Set(sorted.flatMap((m) => (m.labelIds ?? []).filter(isUserLabelId)))].sort(),
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
// alsoTrackLabels: conversations carrying one of these labels are kept even if they aren't in the inbox
// (the task / done labels from Settings > Mail, so labelled emails can become tasks).
export async function applySnapshots(db: DB, userId: string, accountId: string | null, snaps: ThreadSnapshot[], alsoTrackLabels: string[] = []) {
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
    // Only track conversations that reached the inbox, or carry a task/done label.
    if (!prev && !s.inInbox && !s.labelIds?.some((l) => alsoTrackLabels.includes(l))) continue;
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
      labelIds: s.labelIds ?? prev?.labelIds ?? [],
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
        labelIds: ex("label_ids"),
        state: ex("state"),
        hasNewActivity: ex("has_new_activity"),
        snoozedUntil: ex("snoozed_until"),
        stateChangedAt: ex("state_changed_at"),
        updatedAt: ex("updated_at"),
      },
    });
  if (log.length) await db.insert(events).values(log);
}

// Snooze was removed from WorkDesk (user request 2026-10-06): any email still snoozed goes back into the
// queue (Needs decision), whatever time it was snoozed until, with a History entry. New snoozes can't be made.
export async function wakeSnoozed(db: DB, userId?: string) {
  const woken = await db
    .update(emailThreads)
    .set({ state: "needs_decision", snoozedUntil: null, stateChangedAt: new Date() })
    .where(and(eq(emailThreads.state, "snoozed"), userId ? eq(emailThreads.userId, userId) : undefined))
    .returning({ id: emailThreads.id, userId: emailThreads.userId, subject: emailThreads.subject });
  if (woken.length) {
    await db.insert(events).values(
      woken.map((t) => ({
        userId: t.userId,
        entityType: "email" as const,
        entityId: t.id,
        action: "email.unsnoozed",
        summary: "Snooze removed from WorkDesk; returned to queue",
        detail: { subject: t.subject },
      })),
    );
  }
}

// --- Labels ---

export type LabelOp = { threadId: string; labelId: string; add: boolean };

// Applies label additions/removals (in order) to stored conversations in one update.
export async function applyLabelOps(db: DB, userId: string, ops: LabelOp[]) {
  if (ops.length === 0) return;
  const ids = [...new Set(ops.map((o) => o.threadId))];
  const stored = await db
    .select({ gid: emailThreads.gmailThreadId, labelIds: emailThreads.labelIds })
    .from(emailThreads)
    .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.gmailThreadId, ids)));
  const next = new Map(stored.map((t) => [t.gid, new Set(t.labelIds)]));
  for (const o of ops) {
    const set = next.get(o.threadId);
    if (!set) continue; // not a conversation WorkDesk tracks
    if (o.add) set.add(o.labelId);
    else set.delete(o.labelId);
  }
  const updates = stored
    .map((t) => ({ gid: t.gid, before: [...t.labelIds].sort().join(","), after: [...next.get(t.gid)!].sort() }))
    .filter((u) => u.before !== u.after.join(","));
  if (updates.length === 0) return;
  await db.execute(sql`
    update email_threads as t set label_ids = v.labels::text[]
    from (values ${sql.join(updates.map((u) => sql`(${u.gid}, ${`{${u.after.join(",")}}`})`), sql`, `)}) as v(gid, labels)
    where t.user_id = ${userId} and t.gmail_thread_id = v.gid`);
}

const LABEL_REFRESH = 60 * 60_000;

// Reads the user's own labels from Gmail (at most hourly unless forced) and stores them.
export async function refreshLabels(db: DB, token: string, account: Account, force = false) {
  if (!force && account.labelsSyncedAt && Date.now() - account.labelsSyncedAt.getTime() < LABEL_REFRESH) return;
  const { labels = [] } = await listLabels(token);
  const own = labels.filter((l) => l.type === "user" && isUserLabelId(l.id));
  if (own.length) {
    const ex = (col: string) => sql.raw(`excluded.${col}`);
    await db
      .insert(gmailLabels)
      .values(own.map((l) => ({ userId: account.userId, gmailLabelId: l.id, name: l.name, backgroundColor: l.color?.backgroundColor ?? null, textColor: l.color?.textColor ?? null })))
      .onConflictDoUpdate({
        target: [gmailLabels.userId, gmailLabels.gmailLabelId],
        set: { name: ex("name"), backgroundColor: ex("background_color"), textColor: ex("text_color"), updatedAt: new Date() },
      });
  }
  // Labels deleted in Gmail go here too.
  await db
    .delete(gmailLabels)
    .where(and(eq(gmailLabels.userId, account.userId), own.length ? notInArray(gmailLabels.gmailLabelId, own.map((l) => l.id)) : undefined));
  await db.update(gmailAccounts).set({ labelsSyncedAt: new Date() }).where(eq(gmailAccounts.id, account.id));
  account.labelsSyncedAt = new Date();
  await clearMissingTaskLabels(db, account.userId);
}

const BACKFILL_LABELS_PER_RUN = 5;

// One time: conversations stored before labels were tracked get their labels, a few labels per run,
// by listing each label's messages (IDs only; nothing is downloaded).
export async function backfillLabels(db: DB, token: string, account: Account) {
  if (account.labelsBackfilledAt) return;
  const all = await db
    .select({ id: gmailLabels.gmailLabelId })
    .from(gmailLabels)
    .where(eq(gmailLabels.userId, account.userId))
    .orderBy(gmailLabels.gmailLabelId);
  const todo = all.filter((l) => !account.labelsBackfillCursor || l.id > account.labelsBackfillCursor).slice(0, BACKFILL_LABELS_PER_RUN);
  const ops: LabelOp[] = [];
  for (const l of todo) {
    let pageToken: string | undefined;
    for (let page = 0; page < 2; page++) {
      const r = await listMessages(token, "", pageToken, l.id);
      for (const m of r.messages ?? []) ops.push({ threadId: m.threadId, labelId: l.id, add: true });
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
  }
  await applyLabelOps(db, account.userId, ops);
  const done = todo.length < BACKFILL_LABELS_PER_RUN;
  await db
    .update(gmailAccounts)
    .set(done ? { labelsBackfilledAt: new Date(), labelsBackfillCursor: null } : { labelsBackfillCursor: todo.at(-1)!.id })
    .where(eq(gmailAccounts.id, account.id));
}

export type SyncResult = { fetched: number; remaining: number };

type StoredThread = Pick<
  typeof emailThreads.$inferSelect,
  "subject" | "fromName" | "fromEmail" | "snippet" | "lastMessageAt" | "messageCount" | "unread" | "labelIds"
>;

// New messages in a conversation we already store: update it from just those messages.
export function mergeNewMessages(existing: StoredThread | undefined, threadId: string, messages: GmailMessage[]): ThreadSnapshot | null {
  const fresh = snapshotFromGmail(threadId, messages);
  if (!fresh || !existing) return fresh;
  const newer = fresh.lastMessageAt.getTime() > existing.lastMessageAt.getTime();
  return {
    gmailThreadId: threadId,
    subject: existing.subject,
    fromName: newer ? fresh.fromName : existing.fromName,
    fromEmail: newer ? fresh.fromEmail : existing.fromEmail,
    snippet: newer ? fresh.snippet : existing.snippet,
    lastMessageAt: newer ? fresh.lastMessageAt : existing.lastMessageAt,
    messageCount: existing.messageCount + messages.length,
    unread: existing.unread || fresh.unread,
    labelIds: [...new Set([...existing.labelIds, ...(fresh.labelIds ?? [])])].sort(),
    inInbox: true,
  };
}

const ignoreMissing = (e: unknown) => {
  if (e instanceof GmailError && e.status === 404) return null; // deleted in Gmail by the user
  throw e;
};

// Pulls new mail without ever downloading the same message twice:
//  - First sync lists the last 30 days (500 messages per run, continued on later runs) and downloads each
//    conversation once.
//  - After that, Gmail's change log says what is new. A new message in a stored conversation is fetched on
//    its own; a read/unread change is applied from the log without downloading anything.
//  - Every downloaded message ID is recorded in gmail_messages and skipped from then on.
export async function syncAccount(db: DB, env: Env, account: Account, retried = false): Promise<SyncResult> {
  if (!account.refreshTokenEnc) throw new Error("Gmail account is not connected");
  const refreshToken = await decryptSecret(account.refreshTokenEnc, requireEnv(env, "TOKEN_ENC_KEY"));
  const { access_token: token } = await refreshAccessToken(
    requireEnv(env, "GOOGLE_CLIENT_ID"),
    requireEnv(env, "GOOGLE_CLIENT_SECRET"),
    refreshToken,
  );

  const pendingThreads = new Set(account.pendingThreadIds);
  const pendingMessages = new Set(account.pendingMessageIds); // "threadId:messageId"
  const firstRun = !account.historyId;
  let historyId = account.historyId;
  let pageToken = account.initialPageToken;
  const seen: { id: string; threadId: string }[] = [];
  const unreadChanges = new Map<string, boolean>(); // gmail thread id -> unread
  const labelOps: LabelOp[] = []; // the user's own labels added/removed in Gmail, in order

  if (firstRun) historyId = (await getProfile(token)).historyId;

  // The 30-day backfill, continued from where the last run stopped.
  if (firstRun || pageToken) {
    const days = Number(env.SYNC_INITIAL_DAYS || 30);
    for (let page = 0; page < 5; page++) {
      const r = await listMessages(token, `in:inbox newer_than:${days}d`, pageToken ?? undefined);
      seen.push(...(r.messages ?? []));
      pageToken = r.nextPageToken ?? null;
      if (!pageToken) break;
    }
  }

  if (!firstRun) {
    try {
      let next: string | undefined;
      for (let page = 0; page < 10; page++) {
        const r = await listHistory(token, historyId!, next);
        for (const h of r.history ?? []) {
          for (const a of h.messagesAdded ?? []) seen.push(a.message);
          for (const l of h.labelsAdded ?? []) {
            if (l.labelIds.includes("UNREAD")) unreadChanges.set(l.message.threadId, true);
            for (const id of l.labelIds.filter(isUserLabelId)) labelOps.push({ threadId: l.message.threadId, labelId: id, add: true });
          }
          for (const l of h.labelsRemoved ?? []) {
            if (l.labelIds.includes("UNREAD")) unreadChanges.set(l.message.threadId, false);
            for (const id of l.labelIds.filter(isUserLabelId)) labelOps.push({ threadId: l.message.threadId, labelId: id, add: false });
          }
        }
        historyId = r.historyId;
        next = r.nextPageToken;
        if (!next) break;
      }
    } catch (e) {
      // Gmail keeps history for about a week; if ours is too old, list the last 30 days again.
      // Messages already downloaded are still skipped.
      if (e instanceof GmailError && e.status === 404 && !retried) {
        await db.update(gmailAccounts).set({ historyId: null, initialPageToken: null }).where(eq(gmailAccounts.id, account.id));
        return syncAccount(db, env, { ...account, historyId: null, initialPageToken: null }, true);
      }
      throw e;
    }
  }

  // Sort what Gmail reported: skip messages already downloaded; a new message in a stored conversation is
  // fetched on its own; anything else means a new conversation, fetched whole.
  const unique = [...new Map(seen.map((m) => [m.id, m])).values()];
  if (unique.length) {
    const known = new Set<string>();
    const storedThreads = new Set<string>();
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const [k, t] = await Promise.all([
        db
          .select({ id: gmailMessages.gmailMessageId })
          .from(gmailMessages)
          .where(and(eq(gmailMessages.accountId, account.id), inArray(gmailMessages.gmailMessageId, chunk.map((m) => m.id)))),
        db
          .select({ id: emailThreads.gmailThreadId })
          .from(emailThreads)
          .where(and(eq(emailThreads.userId, account.userId), inArray(emailThreads.gmailThreadId, [...new Set(chunk.map((m) => m.threadId))]))),
      ]);
      for (const r of k) known.add(r.id);
      for (const r of t) storedThreads.add(r.id);
    }
    for (const m of unique) {
      if (known.has(m.id) || pendingThreads.has(m.threadId)) continue;
      if (storedThreads.has(m.threadId)) pendingMessages.add(`${m.threadId}:${m.id}`);
      else pendingThreads.add(m.threadId);
    }
  }

  // Label changes too: applied from the change log, nothing is downloaded.
  await applyLabelOps(db, account.userId, labelOps);
  // The label list (at most hourly) and, once, labels for conversations stored before labels existed.
  await refreshLabels(db, token, account);
  // A brand-new account downloads every conversation with its labels, so it needs no backfill.
  if (!firstRun) await backfillLabels(db, token, account);

  // Read/unread changes go straight onto the stored conversation; nothing is downloaded.
  for (const value of [true, false]) {
    const ids = [...unreadChanges].filter(([, v]) => v === value).map(([id]) => id);
    if (ids.length) {
      await db
        .update(emailThreads)
        .set({ unread: value })
        .where(and(eq(emailThreads.userId, account.userId), inArray(emailThreads.gmailThreadId, ids)));
    }
  }

  // Download a batch: new conversations first, then single new messages.
  let budget = Number(env.SYNC_BATCH || 30);
  const threadBatch = [...pendingThreads].slice(0, budget);
  budget -= threadBatch.length;
  const messageBatch = [...pendingMessages].slice(0, Math.max(0, budget));

  const snaps: ThreadSnapshot[] = [];
  const downloaded: (typeof gmailMessages.$inferInsert)[] = [];
  for (let i = 0; i < threadBatch.length; i += 10) {
    const chunk = await Promise.all(threadBatch.slice(i, i + 10).map((id) => getThread(token, id).catch(ignoreMissing)));
    for (const t of chunk) {
      if (!t) continue;
      for (const m of t.messages ?? []) downloaded.push({ accountId: account.id, gmailMessageId: m.id, gmailThreadId: t.id });
      const s = snapshotFromGmail(t.id, t.messages ?? []);
      if (s) snaps.push(s);
    }
  }

  const byThread = new Map<string, GmailMessage[]>();
  for (let i = 0; i < messageBatch.length; i += 10) {
    const refs = messageBatch.slice(i, i + 10).map((key) => {
      const [threadId, id] = key.split(":") as [string, string];
      return { threadId, id };
    });
    const got = await Promise.all(refs.map((r) => getMessage(token, r.id).catch(ignoreMissing)));
    refs.forEach((r, j) => {
      // Recorded even if Gmail no longer has it, so it isn't asked for again.
      downloaded.push({ accountId: account.id, gmailMessageId: r.id, gmailThreadId: r.threadId });
      const m = got[j];
      if (m) byThread.set(r.threadId, [...(byThread.get(r.threadId) ?? []), m]);
    });
  }
  if (byThread.size) {
    const stored = await db
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.userId, account.userId), inArray(emailThreads.gmailThreadId, [...byThread.keys()])));
    const storedById = new Map(stored.map((t) => [t.gmailThreadId, t]));
    for (const [threadId, msgs] of byThread) {
      const s = mergeNewMessages(storedById.get(threadId), threadId, msgs);
      if (s) snaps.push(s);
    }
  }

  const taskLabels = await getTaskLabels(db, account.userId);
  const watched = watchedLabels(taskLabels);
  await applySnapshots(db, account.userId, account.id, snaps, watched);
  // Emails that now carry the task/done label become tasks (and the reverse labels are tidied).
  const touched = [...new Set([...snaps.map((x) => x.gmailThreadId), ...labelOps.map((o) => o.threadId)])];
  if (watched.length) await runLabelRules(db, env, account.userId, touched);
  // Emails with another section's label leave Pending (user request 2026-10-07).
  await applySectionRules(db, account.userId, touched);
  if (downloaded.length) await db.insert(gmailMessages).values(downloaded).onConflictDoNothing();

  const restThreads = [...pendingThreads].slice(threadBatch.length);
  const restMessages = [...pendingMessages].slice(messageBatch.length);
  await db
    .update(gmailAccounts)
    .set({
      historyId,
      initialPageToken: pageToken,
      pendingThreadIds: restThreads,
      pendingMessageIds: restMessages,
      lastSyncAt: new Date(),
      lastSyncError: null,
      ...(firstRun ? { labelsBackfilledAt: new Date() } : {}),
    })
    .where(eq(gmailAccounts.id, account.id));
  return {
    fetched: threadBatch.length + messageBatch.length,
    // A backfill page still to list counts as remaining work, so "Sync now" keeps going until it is done.
    remaining: restThreads.length + restMessages.length + (pageToken ? 1 : 0),
  };
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
      await labelTaskEmails(db, env, userId).catch(() => undefined);
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
  await ensureReportPeriods(db, todayIn(timezone(env)));
  await ensurePensionTasks(db, todayIn(timezone(env)));
  const accounts = await db.select().from(gmailAccounts);
  for (const a of accounts) {
    if (!a.refreshTokenEnc) continue;
    try {
      await syncAccount(db, env, a);
      // Label task emails in Gmail that aren't labelled yet (best effort).
      await labelTaskEmails(db, env, a.userId).catch(() => undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(gmailAccounts).set({ lastSyncError: msg.slice(0, 500) }).where(eq(gmailAccounts.id, a.id));
    }
  }
}
