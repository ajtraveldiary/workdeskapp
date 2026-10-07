// Task labels (Settings > Mail): one Gmail label marks emails that are tasks, another marks emails whose
// task is completed. Kept in step both ways:
//  - Gmail -> WorkDesk (applyLabelRules): an email with the task label gets an open task; an email with the
//    done label gets a completed task (or its open tasks are completed). Runs when a label is first chosen,
//    after every sync, and when labels are changed in the email viewer.
//  - WorkDesk -> Gmail (reconcileThreadLabels): when an email's task is created, completed or reopened, its
//    labels are set to match (task label while any task is open, done label once all are done).
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import { emailThreads, events, gmailAccounts, tasks, users } from "../db/schema";
import type { Env } from "../env";
import { accessTokenFor } from "./gmailAuth";
import { canMarkRead, listMessages, setThreadLabels } from "./gmail";
import { applyLabelOps, type LabelOp } from "./sync";

// autoDoneLabelIds: more labels whose emails go straight to completed tasks (Settings tick boxes); unlike the
// done label, WorkDesk never adds or removes them in Gmail.
export type TaskLabelSettings = { taskLabelId: string | null; doneLabelId: string | null; autoDoneLabelIds: string[]; organizeLabelIds: string[] };

export async function getTaskLabels(db: DB, userId: string): Promise<TaskLabelSettings> {
  const [u] = await db
    .select({ taskLabelId: users.taskLabelId, doneLabelId: users.doneLabelId, autoDoneLabelIds: users.autoDoneLabelIds, organizeLabelIds: users.organizeLabelIds })
    .from(users)
    .where(eq(users.id, userId));
  return u ?? { taskLabelId: null, doneLabelId: null, autoDoneLabelIds: [], organizeLabelIds: [] };
}

// Every label that makes an email's task completed.
// Only the done label now (user request 2026-10-07): other labels mark other sections (lib/sections.ts), so
// their emails no longer become completed tasks or get the done label.
const completingLabels = (s: TaskLabelSettings) => (s.doneLabelId ? [s.doneLabelId] : []);
export const watchedLabels = (s: TaskLabelSettings) => [...new Set([s.taskLabelId, ...completingLabels(s)].filter((x): x is string => !!x))];

const textArray = (ids: string[]) => sql`${`{${ids.join(",")}}`}::text[]`;

// Gmail -> WorkDesk. Only creates or completes tasks; it never reopens or deletes anything.
// Returns the conversations whose tasks it completed, so their labels can be tidied in Gmail.
export async function applyLabelRules(db: DB, userId: string, onlyGmailThreadIds?: string[]) {
  const s = await getTaskLabels(db, userId);
  const watch = watchedLabels(s);
  const completing = completingLabels(s);
  const result = { created: 0, completed: 0, completedThreadIds: [] as string[] };
  if (watch.length === 0 || (onlyGmailThreadIds && onlyGmailThreadIds.length === 0)) return result;

  const threads = await db
    .select({ id: emailThreads.id, subject: emailThreads.subject, labelIds: emailThreads.labelIds, state: emailThreads.state })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        sql`${emailThreads.labelIds} && ${textArray(watch)}`,
        onlyGmailThreadIds ? inArray(emailThreads.gmailThreadId, onlyGmailThreadIds) : undefined,
      ),
    );
  if (threads.length === 0) return result;

  const existing = await db
    .select({ id: tasks.id, threadId: tasks.threadId, status: tasks.status, title: tasks.title })
    .from(tasks)
    .where(inArray(tasks.threadId, threads.map((t) => t.id)));

  const now = new Date();
  const newTasks: (typeof tasks.$inferInsert)[] = [];
  const toComplete: { id: string; title: string; threadId: string }[] = [];
  const intoTasks: string[] = [];
  for (const t of threads) {
    const mine = existing.filter((x) => x.threadId === t.id);
    const done = completing.some((id) => t.labelIds.includes(id));
    const open = !!s.taskLabelId && t.labelIds.includes(s.taskLabelId);
    if (done) {
      if (mine.length === 0) newTasks.push({ userId, title: t.subject, threadId: t.id, status: "done", completedAt: now });
      for (const x of mine.filter((x) => x.status === "open")) toComplete.push({ id: x.id, title: x.title, threadId: t.id });
    } else if (open && mine.length === 0) {
      newTasks.push({ userId, title: t.subject, threadId: t.id });
    }
    if ((done || open) && t.state !== "task") intoTasks.push(t.id);
  }

  const log: (typeof events.$inferInsert)[] = [];
  if (newTasks.length) {
    const created = await db.insert(tasks).values(newTasks).returning({ id: tasks.id, title: tasks.title, status: tasks.status });
    result.created = created.length;
    for (const c of created) {
      log.push({ userId, entityType: "task", entityId: c.id, action: "task.created", summary: c.status === "done" ? "Created as completed from its Gmail label" : "Created from its Gmail label", detail: { title: c.title } });
    }
  }
  if (toComplete.length) {
    await db.update(tasks).set({ status: "done", completedAt: now, updatedAt: now }).where(inArray(tasks.id, toComplete.map((x) => x.id)));
    result.completed = toComplete.length;
    result.completedThreadIds = [...new Set(toComplete.map((x) => x.threadId))];
    for (const x of toComplete) log.push({ userId, entityType: "task", entityId: x.id, action: "task.completed", summary: "Completed by its Gmail label", detail: { title: x.title } });
  }
  if (intoTasks.length) {
    // These emails are now tasks, so they leave Pending.
    await db.update(emailThreads).set({ state: "task", snoozedUntil: null, hasNewActivity: false, stateChangedAt: now, updatedAt: now }).where(inArray(emailThreads.id, intoTasks));
  }
  if (log.length) await db.insert(events).values(log);
  return result;
}

// WorkDesk -> Gmail. Sets each conversation's task/done labels to match its tasks. Gmail is changed only
// when something differs; WorkDesk's copy of the labels is updated only if Gmail accepted the change.
// Returns how many conversations were relabelled.
export async function reconcileThreadLabels(db: DB, env: Env, userId: string, threadIds: string[]) {
  if (threadIds.length === 0) return 0;
  const s = await getTaskLabels(db, userId);
  if (!s.taskLabelId && !s.doneLabelId) return 0;

  const threads = await db
    .select({ id: emailThreads.id, gmailThreadId: emailThreads.gmailThreadId, accountId: emailThreads.accountId, labelIds: emailThreads.labelIds })
    .from(emailThreads)
    .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, threadIds)));
  const linked = await db.select({ threadId: tasks.threadId, status: tasks.status }).from(tasks).where(inArray(tasks.threadId, threadIds));

  let token: string | null | undefined;
  const getToken = async (accountId: string) => {
    if (token !== undefined) return token;
    const [a] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, accountId));
    token = a && canMarkRead(a.grantedScopes) ? await accessTokenFor(env, a) : null;
    return token;
  };

  const ops: LabelOp[] = [];
  let changed = 0;
  for (const t of threads) {
    const mine = linked.filter((x) => x.threadId === t.id);
    if (mine.length === 0) continue;
    const anyOpen = mine.some((x) => x.status === "open");
    const add: string[] = [];
    const remove: string[] = [];
    const want = (id: string | null, on: boolean) => {
      if (!id) return;
      const has = t.labelIds.includes(id);
      if (on && !has) add.push(id);
      if (!on && has) remove.push(id);
    };
    want(s.taskLabelId, anyOpen);
    want(s.doneLabelId, !anyOpen);
    if (add.length === 0 && remove.length === 0) continue;

    if (t.accountId) {
      const tok = await getToken(t.accountId);
      if (!tok) continue; // signed in before label permission existed: leave Gmail (and the copy) as they are
      try {
        await setThreadLabels(tok, t.gmailThreadId, add, remove);
      } catch {
        continue; // a Gmail hiccup must never block completing a task; the next change retries
      }
    }
    for (const id of add) ops.push({ threadId: t.gmailThreadId, labelId: id, add: true });
    for (const id of remove) ops.push({ threadId: t.gmailThreadId, labelId: id, add: false });
    changed++;
  }
  await applyLabelOps(db, userId, ops);
  return changed;
}

// An email whose tasks were all deleted (user request 2026-10-07) loses WorkDesk's task and done labels in
// Gmail, so applyLabelRules doesn't make the task again. Best effort, like reconcileThreadLabels; labels the
// user ticked as "auto-done" are theirs and are never touched.
export async function clearTaskLabels(db: DB, env: Env, userId: string, threadIds: string[]) {
  if (threadIds.length === 0) return 0;
  const s = await getTaskLabels(db, userId);
  const ours = [s.taskLabelId, s.doneLabelId].filter((x): x is string => !!x);
  if (ours.length === 0) return 0;
  const threads = await db
    .select({ gmailThreadId: emailThreads.gmailThreadId, accountId: emailThreads.accountId, labelIds: emailThreads.labelIds })
    .from(emailThreads)
    .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, threadIds)));
  const ops: LabelOp[] = [];
  let token: string | null | undefined;
  for (const t of threads) {
    const remove = ours.filter((id) => t.labelIds.includes(id));
    if (remove.length === 0) continue;
    if (t.accountId) {
      if (token === undefined) {
        const [a] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, t.accountId));
        token = a && canMarkRead(a.grantedScopes) ? await accessTokenFor(env, a) : null;
      }
      if (!token) continue;
      try {
        await setThreadLabels(token, t.gmailThreadId, [], remove);
      } catch {
        continue;
      }
    }
    for (const id of remove) ops.push({ threadId: t.gmailThreadId, labelId: id, add: false });
  }
  await applyLabelOps(db, userId, ops);
  return ops.length;
}

// Catch-up (user request 2026-10-06: every email in tasks and completed tasks carries the chosen label in Gmail):
// finds conversations whose task/done labels don't match their tasks yet (tasks made before a label was chosen,
// or a Gmail call that failed) and fixes a batch of them. Runs after each sync and when the labels are chosen;
// the batch keeps one run within the Worker's request limits, and later runs continue with the rest.
export async function labelTaskEmails(db: DB, env: Env, userId: string, limit = 20) {
  const s = await getTaskLabels(db, userId);
  if (!s.taskLabelId && !s.doneLabelId) return { labelled: 0, remaining: 0 };
  const rows = await db
    .select({ threadId: emailThreads.id, labelIds: emailThreads.labelIds, status: tasks.status })
    .from(tasks)
    .innerJoin(emailThreads, eq(tasks.threadId, emailThreads.id))
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.threadId)));

  const byThread = new Map<string, { labelIds: string[]; anyOpen: boolean }>();
  for (const r of rows) {
    const t = byThread.get(r.threadId) ?? { labelIds: r.labelIds, anyOpen: false };
    t.anyOpen ||= r.status === "open";
    byThread.set(r.threadId, t);
  }
  const has = (t: { labelIds: string[] }, id: string | null) => !!id && t.labelIds.includes(id);
  const todo = [...byThread]
    .filter(([, t]) =>
      t.anyOpen
        ? (s.taskLabelId && !has(t, s.taskLabelId)) || has(t, s.doneLabelId)
        : (s.doneLabelId && !has(t, s.doneLabelId)) || has(t, s.taskLabelId),
    )
    .map(([id]) => id);
  // A random batch, so a conversation Gmail keeps refusing can't hold up the others.
  const batch = todo.sort(() => Math.random() - 0.5).slice(0, limit);
  const labelled = await reconcileThreadLabels(db, env, userId, batch);
  return { labelled, remaining: todo.length - batch.length };
}

// After a sync or a label change: Gmail -> WorkDesk, then tidy the labels of tasks it completed.
export async function runLabelRules(db: DB, env: Env, userId: string, onlyGmailThreadIds?: string[]) {
  const r = await applyLabelRules(db, userId, onlyGmailThreadIds);
  if (r.completedThreadIds.length) await reconcileThreadLabels(db, env, userId, r.completedThreadIds);
  return r;
}

const IMPORT_PAGES = 5; // up to 500 most recent messages per label

// First choice of a task/done label: bring every Gmail email with that label into WorkDesk and turn them
// into tasks. Conversations WorkDesk hasn't downloaded yet are queued for the next syncs (they become
// tasks as they arrive, even if they aren't in the inbox).
export async function importLabel(db: DB, env: Env, userId: string, labelId: string) {
  const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  let queued = 0;
  if (account?.refreshTokenEnc) {
    const token = await accessTokenFor(env, account);
    const threadIds = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < IMPORT_PAGES; page++) {
      const r = await listMessages(token, "", pageToken, labelId);
      for (const m of r.messages ?? []) threadIds.add(m.threadId);
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    const ids = [...threadIds];
    const stored = ids.length
      ? (await db.select({ gid: emailThreads.gmailThreadId }).from(emailThreads).where(and(eq(emailThreads.userId, userId), inArray(emailThreads.gmailThreadId, ids)))).map((r) => r.gid)
      : [];
    // Stored conversations: make sure WorkDesk's copy has the label (older copies may predate labels).
    await applyLabelOps(db, userId, stored.map((gid) => ({ threadId: gid, labelId, add: true })));
    const missing = ids.filter((id) => !stored.includes(id));
    if (missing.length) {
      const pending = [...new Set([...account.pendingThreadIds, ...missing])];
      await db.update(gmailAccounts).set({ pendingThreadIds: pending }).where(eq(gmailAccounts.id, account.id));
      queued = missing.length;
    }
  }
  const r = await runLabelRules(db, env, userId);
  return { created: r.created, completed: r.completed, queued };
}

// A task / done label that no longer exists (deleted here or in Gmail) is unset.
export async function clearMissingTaskLabels(db: DB, userId: string) {
  for (const col of ["task_label_id", "done_label_id"] as const) {
    await db.execute(sql`
      update users set ${sql.raw(col)} = null
      where id = ${userId} and ${sql.raw(col)} is not null
        and ${sql.raw(col)} not in (select gmail_label_id from gmail_labels where user_id = ${userId})`);
  }
  await db.execute(sql`
    update users set auto_done_label_ids = coalesce(
      (select array_agg(l) from unnest(auto_done_label_ids) l where l in (select gmail_label_id from gmail_labels where user_id = ${userId})),
      '{}')
    where id = ${userId} and cardinality(auto_done_label_ids) > 0`);
}
