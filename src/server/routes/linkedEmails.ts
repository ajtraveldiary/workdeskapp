// More emails on a task or an event (user request 2026-10-17; user's choices: they behave like the main email,
// added from Task details / Event details out of Pending, listed there with ✕ to take one off). Mounted at
// /api/linked-emails: GET ?taskId= | ?eventId= lists the main email and the added ones; POST adds Pending emails;
// DELETE /:threadId?taskId= | ?eventId= takes one off (back to Pending when nothing else has it). Only WorkDesk's
// database and the user's own task/done labels in Gmail change; every add / remove goes in History.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { emailThreads, events, linkedEmails, officeEvents, tasks } from "../db/schema";
import { tasksOfThreads } from "../lib/linkedEmails";
import { clearTaskLabels, reconcileThreadLabels } from "../lib/taskLabels";
import type { LinkedEmail } from "../../shared/types";

const owner = z.union([z.object({ taskId: z.uuid(), eventId: z.undefined().optional() }), z.object({ eventId: z.uuid(), taskId: z.undefined().optional() })]);
const addInput = z.intersection(owner, z.object({ threadIds: z.array(z.uuid()).min(1).max(30) }));

// The task or event, checked to be this user's, with its title and main email.
async function loadOwner(db: DB, userId: string, o: { taskId?: string; eventId?: string }) {
  if (o.taskId) {
    const [t] = await db.select({ id: tasks.id, title: tasks.title, threadId: tasks.threadId, status: tasks.status }).from(tasks).where(and(eq(tasks.id, o.taskId), eq(tasks.userId, userId)));
    if (!t) throw new HTTPException(404, { message: "Task not found" });
    return { kind: "task" as const, ...t };
  }
  const [e] = await db.select({ id: officeEvents.id, title: officeEvents.title, threadId: officeEvents.threadId }).from(officeEvents).where(and(eq(officeEvents.id, o.eventId!), eq(officeEvents.userId, userId)));
  if (!e) throw new HTTPException(404, { message: "Event not found" });
  return { kind: "event" as const, status: "open" as const, ...e };
}

const linksOf = (db: DB, o: { kind: "task" | "event"; id: string }) =>
  db.select().from(linkedEmails).where(o.kind === "task" ? eq(linkedEmails.taskId, o.id) : eq(linkedEmails.eventId, o.id));

export const linkedEmailRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const o = await loadOwner(db, userId, owner.parse({ taskId: c.req.query("taskId") || undefined, eventId: c.req.query("eventId") || undefined }));
    const links = await linksOf(db, o);
    const ids = [...new Set([o.threadId, ...links.map((l) => l.threadId)].filter((x): x is string => !!x))];
    const threads = ids.length ? await db.select().from(emailThreads).where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, ids))).orderBy(asc(emailThreads.lastMessageAt)) : [];
    const emails = threads.map(
      (t): LinkedEmail => ({
        id: t.id,
        subject: t.subject,
        fromName: t.fromName,
        fromEmail: t.fromEmail,
        lastMessageAt: t.lastMessageAt.toISOString(),
        unread: t.unread,
        hasNewActivity: t.hasNewActivity,
        main: t.id === o.threadId,
      }),
    );
    // The main email first, then the added ones in date order.
    emails.sort((a, b) => Number(b.main) - Number(a.main));
    return c.json({ emails });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = addInput.parse(await c.req.json());
    const o = await loadOwner(db, userId, input);
    const threads = await db.select().from(emailThreads).where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, input.threadIds)));
    if (threads.length !== new Set(input.threadIds).size) throw new HTTPException(404, { message: "Email not found" });
    // Only emails waiting for a decision (Pending or Other sections), and not already this one's main email.
    const ok = threads.filter((t) => (t.state === "needs_decision" || t.state === "elsewhere") && t.id !== o.threadId);
    if (!ok.length) throw new HTTPException(409, { message: "Those emails are no longer waiting for a decision" });
    await db
      .insert(linkedEmails)
      .values(ok.map((t) => ({ userId, threadId: t.id, ...(o.kind === "task" ? { taskId: o.id } : { eventId: o.id }) })))
      .onConflictDoNothing();
    const now = new Date();
    await db
      .update(emailThreads)
      .set({ state: o.kind === "task" ? "task" : "event", hasNewActivity: false, snoozedUntil: null, stateChangedAt: now, updatedAt: now })
      .where(inArray(emailThreads.id, ok.map((t) => t.id)));
    await db.insert(events).values(
      ok.map((t) => ({
        userId,
        entityType: "email" as const,
        entityId: t.id,
        action: o.kind === "task" ? "email.converted" : "email.event",
        summary: `Added to ${o.kind === "task" ? "task" : "event"}: ${o.title}`,
        detail: { subject: t.subject },
      })),
    );
    // A task's emails carry its task / done label in Gmail, like its main email.
    if (o.kind === "task") await reconcileThreadLabels(db, c.env, userId, ok.map((t) => t.id)).catch(() => undefined);
    return c.json({ added: ok.length, skipped: input.threadIds.length - ok.length }, 201);
  })

  // Taken off: back to Pending unless another task or event still has it (then it stays as it is).
  .delete("/:threadId", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const o = await loadOwner(db, userId, owner.parse({ taskId: c.req.query("taskId") || undefined, eventId: c.req.query("eventId") || undefined }));
    const threadId = c.req.param("threadId");
    if (threadId === o.threadId) throw new HTTPException(400, { message: "That is its own email" });
    const gone = await db
      .delete(linkedEmails)
      .where(and(eq(linkedEmails.threadId, threadId), o.kind === "task" ? eq(linkedEmails.taskId, o.id) : eq(linkedEmails.eventId, o.id)))
      .returning({ id: linkedEmails.id });
    if (!gone.length) return c.json({ ok: true });
    const [t] = await db.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), eq(emailThreads.userId, userId)));
    if (!t) return c.json({ ok: true });
    const otherTasks = await tasksOfThreads(db, [t.id]);
    const otherEvents = await db.select({ id: linkedEmails.id }).from(linkedEmails).where(and(eq(linkedEmails.threadId, t.id), eq(linkedEmails.userId, userId), isNotNull(linkedEmails.eventId)));
    const [mainOfEvent] = await db.select({ id: officeEvents.id }).from(officeEvents).where(eq(officeEvents.threadId, t.id));
    // Stays only while another open task (or another event) still has it; otherwise back to Pending, with its
    // Gmail labels matching what is left (none, or the done label of a task it already had).
    const stillHad = o.kind === "task" ? otherTasks.some((x) => x.status === "open") : otherEvents.length > 0 || !!mainOfEvent;
    if (!stillHad && t.state === (o.kind === "task" ? "task" : "event")) {
      await db.update(emailThreads).set({ state: "needs_decision", hasNewActivity: false, stateChangedAt: new Date(), updatedAt: new Date() }).where(eq(emailThreads.id, t.id));
      if (o.kind === "task") {
        if (otherTasks.length) await reconcileThreadLabels(db, c.env, userId, [t.id]).catch(() => undefined);
        else await clearTaskLabels(db, c.env, userId, [t.id]).catch(() => undefined);
      }
    }
    await db.insert(events).values({
      userId,
      entityType: "email",
      entityId: t.id,
      action: "email.returned",
      summary: `Taken off ${o.kind === "task" ? "task" : "event"}: ${o.title}${stillHad ? "" : "; back to Pending"}`,
      detail: { subject: t.subject },
    });
    return c.json({ ok: true });
  });
