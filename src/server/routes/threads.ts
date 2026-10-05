import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { EMAIL_STATES, emailThreads, gmailAccounts, tasks } from "../db/schema";
import { logEvent } from "../lib/audit";
import { maintain } from "../lib/maintenance";
import { isMuted, notMuted } from "../lib/muted";
import { accessTokenFor } from "../lib/gmailAuth";
import { GmailError, canMarkRead, getAttachment, getMessageFull, getThreadFull, markThreadRead } from "../lib/gmail";
import { decodeBase64Url, demoContent, demoPdf, findPart, parseMessage } from "../lib/emailContent";
import { bulkIds, snoozeInput, taskInput, threadPatch } from "../../shared/schemas";
import { events } from "../db/schema";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";
import type { EmailContent, EmailMessageContent, ThreadTaskInfo } from "../../shared/types";

// Every route here changes only WorkDesk's own database. Gmail is never written to.

export const threadColumns = {
  id: emailThreads.id,
  gmailThreadId: emailThreads.gmailThreadId,
  accountEmail: gmailAccounts.email,
  subject: emailThreads.subject,
  fromName: emailThreads.fromName,
  fromEmail: emailThreads.fromEmail,
  snippet: emailThreads.snippet,
  lastMessageAt: emailThreads.lastMessageAt,
  messageCount: emailThreads.messageCount,
  unread: emailThreads.unread,
  state: emailThreads.state,
  snoozedUntil: emailThreads.snoozedUntil,
  hasNewActivity: emailThreads.hasNewActivity,
  categoryId: emailThreads.categoryId,
  stateChangedAt: emailThreads.stateChangedAt,
  // On the user's "hide from Pending" list (Settings > Mail)
  muted: isMuted,
};

export function selectThreads(db: DB) {
  return db.select(threadColumns).from(emailThreads).leftJoin(gmailAccounts, eq(emailThreads.accountId, gmailAccounts.id));
}

type ThreadRow = Awaited<ReturnType<ReturnType<typeof selectThreads>["execute"]>>[number];

// Adds the state of each email's linked tasks (open / done / overdue), so lists can tag them.
export async function withTaskInfo<T extends ThreadRow>(db: DB, threads: T[], today: string) {
  const ids = threads.map((t) => t.id);
  const rows = ids.length
    ? await db
        .select({
          threadId: tasks.threadId,
          open: sql<number>`(count(*) filter (where ${tasks.status} = 'open'))::int`,
          done: sql<number>`(count(*) filter (where ${tasks.status} = 'done'))::int`,
          overdue: sql<boolean>`coalesce(bool_or(${tasks.status} = 'open' and ${tasks.dueDate} < ${today}), false)`,
        })
        .from(tasks)
        .where(inArray(tasks.threadId, ids))
        .groupBy(tasks.threadId)
    : [];
  const byThread = new Map(rows.map((r) => [r.threadId, { open: Number(r.open), done: Number(r.done), overdue: !!r.overdue }]));
  return threads.map((t) => ({ ...t, task: (byThread.get(t.id) ?? null) as ThreadTaskInfo | null }));
}

const IMMUTABLE = "private, max-age=31536000, immutable";
// Shown inside the page; every other type is download-only.
const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

function wrap(text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else line += " " + word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

async function loadAccount(db: DB, accountId: string) {
  const [a] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, accountId));
  if (!a) throw new HTTPException(404, { message: "Gmail account not found" });
  return a;
}

async function loadThread(db: DB, userId: string, id: string) {
  const [t] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, id), eq(emailThreads.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Email not found" });
  return t;
}

async function setState(
  db: DB,
  userId: string,
  id: string,
  set: Partial<typeof emailThreads.$inferInsert>,
  action: string,
  summary: string,
) {
  const t = await loadThread(db, userId, id);
  await db
    .update(emailThreads)
    .set({ snoozedUntil: null, ...set, stateChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(emailThreads.id, t.id));
  await logEvent(db, { userId, entityType: "email", entityId: t.id, action, summary, detail: { subject: t.subject } });
  return t;
}

export const threadRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    await maintain(db, userId, todayIn(timezone(c.env)));

    const state = c.req.query("state") ?? "needs_decision";
    const q = c.req.query("q")?.trim();
    const where: (SQL | undefined)[] = [eq(emailThreads.userId, userId)];
    if (state !== "all") {
      if (!(EMAIL_STATES as readonly string[]).includes(state)) throw new HTTPException(400, { message: "Unknown state" });
      where.push(eq(emailThreads.state, state as (typeof EMAIL_STATES)[number]));
    }
    // Pending skips senders hidden in Settings > Mail; they still appear under All emails.
    if (state === "needs_decision") where.push(notMuted);
    if (c.req.query("unread") === "1") where.push(eq(emailThreads.unread, true));
    const category = c.req.query("category");
    if (category) where.push(eq(emailThreads.categoryId, category));
    if (q) {
      const like = `%${q}%`;
      where.push(
        or(
          ilike(emailThreads.subject, like),
          ilike(emailThreads.fromName, like),
          ilike(emailThreads.fromEmail, like),
          ilike(emailThreads.snippet, like),
        ),
      );
    }

    const [threads, counts] = await Promise.all([
      selectThreads(db)
        .where(and(...where))
        .orderBy(desc(emailThreads.lastMessageAt))
        .limit(300),
      db
        .select({ state: emailThreads.state, muted: isMuted, n: count() })
        .from(emailThreads)
        .where(eq(emailThreads.userId, userId))
        .groupBy(emailThreads.state, isMuted),
    ]);
    // needs_decision counts only what is shown in Pending; hiddenPending is the rest.
    const byState: Record<string, number> = {};
    let hiddenPending = 0;
    for (const r of counts) {
      if (r.state === "needs_decision" && r.muted) hiddenPending += r.n;
      else byState[r.state] = (byState[r.state] ?? 0) + r.n;
    }
    return c.json({
      threads: await withTaskInfo(db, threads, todayIn(timezone(c.env))),
      counts: byState,
      hiddenPending,
    });
  })

  // The whole conversation, read from Gmail for the viewer. The client asks with ?v=<version> (the time of
  // the latest message); content for a given version never changes, so the browser may keep it and the
  // same email isn't fetched from Gmail twice. Nothing is stored in the database.
  .get("/:id/content", async (c) => {
    const db = c.get("db");
    const t = await loadThread(db, c.get("userId"), c.req.param("id"));
    const version = t.lastMessageAt.getTime();
    let messages: EmailMessageContent[];
    if (!t.accountId) {
      messages = demoContent(t);
    } else {
      const token = await accessTokenFor(c.env, await loadAccount(db, t.accountId));
      const g = await getThreadFull(token, t.gmailThreadId);
      messages = (g.messages ?? []).map(parseMessage);
    }
    c.header("Cache-Control", c.req.query("v") === String(version) ? IMMUTABLE : "no-store");
    return c.json({ threadId: t.id, version, messages } satisfies EmailContent);
  })

  // One attachment, streamed from Gmail. Only PDFs and common images are shown in the page; anything else
  // is offered as a download, and the response is sandboxed so a file can never run code on this site.
  .get("/:id/messages/:messageId/parts/:partId", async (c) => {
    const db = c.get("db");
    const t = await loadThread(db, c.get("userId"), c.req.param("id"));
    const partId = c.req.param("partId");
    let bytes: Uint8Array;
    let mime: string;
    let filename: string;
    if (!t.accountId) {
      bytes = demoPdf(t.subject, [`From: ${t.fromName ?? t.fromEmail ?? ""}`, "", ...wrap(t.snippet, 80), "", "(Sample attachment in demo mode.)"]);
      mime = "application/pdf";
      filename = `${t.subject.slice(0, 40)}.pdf`;
    } else {
      const token = await accessTokenFor(c.env, await loadAccount(db, t.accountId));
      const m = await getMessageFull(token, c.req.param("messageId"));
      const part = m.threadId === t.gmailThreadId ? findPart(m, partId) : null;
      if (!part) throw new HTTPException(404, { message: "Attachment not found" });
      const data = part.body?.data ?? (part.body?.attachmentId ? (await getAttachment(token, m.id, part.body.attachmentId)).data : "");
      bytes = decodeBase64Url(data);
      mime = (part.mimeType ?? "application/octet-stream").toLowerCase();
      filename = part.filename || `attachment-${partId}`;
    }
    const viewable = VIEWABLE.has(mime) && c.req.query("download") !== "1";
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": viewable ? mime : "application/octet-stream",
      "Content-Disposition": `${viewable ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // A PDF can't run code on this site, and browsers refuse to show sandboxed PDFs in a new tab.
      ...(viewable && mime === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox" }),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": IMMUTABLE,
    });
  })

  // Opening an email in the viewer marks it read in Gmail too (approved by the user). Without the newer
  // permission it reports that a fresh sign-in is needed instead of failing.
  .post("/:id/read", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadThread(db, userId, c.req.param("id"));
    if (t.accountId) {
      const account = await loadAccount(db, t.accountId);
      if (!canMarkRead(account.grantedScopes)) return c.json({ marked: false, reason: "permission" as const });
      try {
        await markThreadRead(await accessTokenFor(c.env, account), t.gmailThreadId);
      } catch (e) {
        if (e instanceof GmailError && e.status === 403) return c.json({ marked: false, reason: "permission" as const });
        throw e;
      }
      await logEvent(db, { userId, entityType: "email", entityId: t.id, action: "email.marked_read", summary: "Marked read in Gmail (opened in WorkDesk)", detail: { subject: t.subject } });
    }
    await db.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, t.id));
    return c.json({ marked: true });
  })

  .post("/:id/task", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = taskInput.parse(await c.req.json());
    const t = await loadThread(db, userId, c.req.param("id"));
    const [task] = await db
      .insert(tasks)
      .values({ ...input, userId, threadId: t.id, categoryId: input.categoryId ?? t.categoryId })
      .returning();
    await db
      .update(emailThreads)
      .set({ state: "task", snoozedUntil: null, hasNewActivity: false, stateChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailThreads.id, t.id));
    await db.insert(events).values([
      { userId, entityType: "email", entityId: t.id, action: "email.converted", summary: "Converted to task", detail: { subject: t.subject } },
      { userId, entityType: "task", entityId: task!.id, action: "task.created", summary: "Created from email", detail: { title: task!.title, subject: t.subject } },
    ]);
    return c.json(task, 201);
  })

  .post("/:id/dismiss", async (c) => {
    await setState(c.get("db"), c.get("userId"), c.req.param("id"), { state: "dismissed" }, "email.dismissed", "Dismissed from queue");
    return c.json({ ok: true });
  })

  .post("/bulk-dismiss", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { ids } = bulkIds.parse(await c.req.json());
    const done = await db
      .update(emailThreads)
      .set({ state: "dismissed", snoozedUntil: null, stateChangedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, ids), eq(emailThreads.state, "needs_decision")))
      .returning({ id: emailThreads.id, subject: emailThreads.subject });
    if (done.length) {
      await db.insert(events).values(
        done.map((t) => ({
          userId,
          entityType: "email" as const,
          entityId: t.id,
          action: "email.dismissed",
          summary: "Dismissed from queue (bulk)",
          detail: { subject: t.subject },
        })),
      );
    }
    return c.json({ dismissed: done.length });
  })

  .post("/:id/restore", async (c) => {
    await setState(c.get("db"), c.get("userId"), c.req.param("id"), { state: "needs_decision" }, "email.restored", "Returned to queue");
    return c.json({ ok: true });
  })

  .post("/:id/snooze", async (c) => {
    const { until } = snoozeInput.parse(await c.req.json());
    const when = new Date(until);
    if (when.getTime() <= Date.now()) throw new HTTPException(400, { message: "Snooze time must be in the future" });
    await setState(
      c.get("db"),
      c.get("userId"),
      c.req.param("id"),
      { state: "snoozed", snoozedUntil: when },
      "email.snoozed",
      `Snoozed until ${when.toISOString()}`,
    );
    return c.json({ ok: true });
  })

  .post("/:id/seen", async (c) => {
    const db = c.get("db");
    const t = await loadThread(db, c.get("userId"), c.req.param("id"));
    await db.update(emailThreads).set({ hasNewActivity: false }).where(eq(emailThreads.id, t.id));
    return c.json({ ok: true });
  })

  .patch("/:id", async (c) => {
    const db = c.get("db");
    const { categoryId } = threadPatch.parse(await c.req.json());
    const t = await loadThread(db, c.get("userId"), c.req.param("id"));
    await db.update(emailThreads).set({ categoryId, updatedAt: new Date() }).where(eq(emailThreads.id, t.id));
    return c.json({ ok: true });
  });
