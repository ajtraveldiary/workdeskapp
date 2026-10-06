// Gmail labels: read from Gmail and managed there (approved by the user on 2026-10-06). Demo mode, with no
// Gmail account, keeps labels in WorkDesk only so the feature can be tried.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { emailThreads, events, gmailAccounts, gmailLabels, reports, tasks, users } from "../db/schema";
import { accessTokenFor } from "../lib/gmailAuth";
import { GmailError, canMarkRead, createLabel, deleteLabel, setThreadLabels, updateLabel } from "../lib/gmail";
import { applyLabelOps, refreshLabels } from "../lib/sync";
import { labelInput, labelPatch, taskLabelSettingsInput, threadLabelsInput } from "../../shared/schemas";
import { clearMissingTaskLabels, getTaskLabels, importLabel, labelTaskEmails, runLabelRules } from "../lib/taskLabels";
import { LABEL_COLORS } from "../../shared/labelColors";
import type { Label } from "../../shared/types";

async function accountOf(db: DB, userId: string) {
  const [a] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  return a ?? null;
}

// Gmail refuses label changes for sign-ins from before the gmail.modify permission; say so plainly.
function permissionError(e: unknown): never {
  if (e instanceof GmailError && e.status === 403) throw new HTTPException(403, { message: "Sign in again to let WorkDesk manage Gmail labels" });
  if (e instanceof GmailError && e.status === 409) throw new HTTPException(409, { message: "A label with that name already exists in Gmail" });
  if (e instanceof GmailError && e.status === 400) throw new HTTPException(400, { message: "Gmail didn't accept that label (check the name and colour)" });
  throw e;
}

async function listLocal(db: DB, userId: string): Promise<Label[]> {
  return db
    .select({ id: gmailLabels.gmailLabelId, name: gmailLabels.name, backgroundColor: gmailLabels.backgroundColor, textColor: gmailLabels.textColor })
    .from(gmailLabels)
    .where(eq(gmailLabels.userId, userId))
    .orderBy(asc(sql`lower(${gmailLabels.name})`));
}

async function saveLocal(db: DB, userId: string, l: { id: string; name: string; color?: { backgroundColor: string; textColor: string } | null }) {
  const values = { userId, gmailLabelId: l.id, name: l.name, backgroundColor: l.color?.backgroundColor ?? null, textColor: l.color?.textColor ?? null };
  await db
    .insert(gmailLabels)
    .values(values)
    .onConflictDoUpdate({ target: [gmailLabels.userId, gmailLabels.gmailLabelId], set: { ...values, updatedAt: new Date() } });
}

// Demo mode starts with a few sample labels so there is something to see.
async function seedDemoLabels(db: DB, userId: string) {
  const samples = [
    { id: "Label_demo_accounts", name: "Accounts", color: LABEL_COLORS[5] },
    { id: "Label_demo_urgent", name: "Urgent", color: LABEL_COLORS[0] },
    { id: "Label_demo_hmis", name: "HMIS", color: LABEL_COLORS[3] },
  ];
  for (const s of samples) await saveLocal(db, userId, { id: s.id, name: s.name, color: { backgroundColor: s.color.backgroundColor, textColor: s.color.textColor } });
  await applyLabelOps(db, userId, [
    { threadId: "demo-0", labelId: "Label_demo_accounts", add: true },
    { threadId: "demo-0", labelId: "Label_demo_urgent", add: true },
    { threadId: "demo-1", labelId: "Label_demo_hmis", add: true },
  ]);
}

export const labelRoutes = new Hono<AppEnv>()
  // Settings > Mail: the task label and the done label.
  .get("/task-settings", async (c) => c.json(await getTaskLabels(c.get("db"), c.get("userId"))))

  // Choosing a label (or a different one) turns every email that has it into a task: open for the task
  // label, completed for the done label and the ticked "straight to completed" labels. Emails not yet in
  // WorkDesk are fetched over the next syncs.
  .put("/task-settings", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = taskLabelSettingsInput.parse(await c.req.json());
    if (input.taskLabelId && input.taskLabelId === input.doneLabelId) throw new HTTPException(400, { message: "Choose two different labels" });
    // The done label already completes tasks, and the task label can't also mean completed.
    if (input.autoDoneLabelIds) input.autoDoneLabelIds = [...new Set(input.autoDoneLabelIds)].filter((id) => id !== input.doneLabelId);
    if (input.taskLabelId && input.autoDoneLabelIds?.includes(input.taskLabelId))
      throw new HTTPException(400, { message: "The task label can't also go straight to completed tasks" });
    const known = new Set((await listLocal(db, userId)).map((l) => l.id));
    for (const id of [input.taskLabelId, input.doneLabelId, ...(input.autoDoneLabelIds ?? [])]) if (id && !known.has(id)) throw new HTTPException(400, { message: "Unknown label" });
    const before = await getTaskLabels(db, userId);
    await db.update(users).set(input).where(eq(users.id, userId));

    const result = { created: 0, completed: 0, queued: 0, labelled: 0, toLabel: 0 };
    const had = new Set([before.taskLabelId, before.doneLabelId, ...before.autoDoneLabelIds]);
    for (const id of [input.taskLabelId, input.doneLabelId, ...(input.autoDoneLabelIds ?? [])]) {
      if (!id || had.has(id)) continue; // only newly chosen labels import
      had.add(id);
      const r = await importLabel(db, c.env, userId, id);
      result.created += r.created;
      result.completed += r.completed;
      result.queued += r.queued;
    }
    // WorkDesk -> Gmail: label the emails that are already tasks or completed tasks; syncs continue with the rest.
    const l = await labelTaskEmails(db, c.env, userId, 25).catch(() => ({ labelled: 0, remaining: 0 }));
    result.labelled = l.labelled;
    result.toLabel = l.remaining;
    const names = Object.fromEntries((await listLocal(db, userId)).map((l) => [l.id, l.name]));
    const after = await getTaskLabels(db, userId);
    const straight = after.autoDoneLabelIds.map((id) => names[id] ?? id).join(", ");
    const summary = `Task label: ${after.taskLabelId ? names[after.taskLabelId] : "none"} · Done label: ${after.doneLabelId ? names[after.doneLabelId] : "none"}${straight ? ` · Straight to completed: ${straight}` : ""}`;
    await db.insert(events).values({ userId, entityType: "email", action: "settings.task_labels", summary, detail: { subject: summary } });
    return c.json(result);
  })
  // ?refresh=1 re-reads the list from Gmail now; otherwise it is refreshed at most hourly.
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const account = await accountOf(db, userId);
    if (account?.refreshTokenEnc) {
      await refreshLabels(db, await accessTokenFor(c.env, account), account, c.req.query("refresh") === "1");
    } else if (c.get("demo") && (await listLocal(db, userId)).length === 0) {
      await seedDemoLabels(db, userId);
    }
    return c.json({
      labels: await listLocal(db, userId),
      // Managing labels needs the gmail.modify permission (sign-ins before it was added must sign in again).
      canEdit: c.get("demo") || canMarkRead(account?.grantedScopes),
      syncedAt: account?.labelsSyncedAt ?? null,
    });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = labelInput.parse(await c.req.json());
    const account = await accountOf(db, userId);
    let label: { id: string; name: string; color?: { backgroundColor: string; textColor: string } | null };
    if (account?.refreshTokenEnc) {
      const created = await createLabel(await accessTokenFor(c.env, account), { name: input.name, ...(input.color ? { color: input.color } : {}) }).catch(permissionError);
      label = { id: created!.id, name: created!.name, color: created!.color ?? input.color };
    } else {
      if ((await listLocal(db, userId)).some((l) => l.name.toLowerCase() === input.name.toLowerCase())) throw new HTTPException(409, { message: "A label with that name already exists" });
      label = { id: `Label_demo_${crypto.randomUUID().slice(0, 8)}`, name: input.name, color: input.color };
    }
    await saveLocal(db, userId, label);
    await db.insert(events).values({ userId, entityType: "email", action: "label.created", summary: "Label created in Gmail", detail: { subject: label.name } });
    return c.json({ id: label.id }, 201);
  })

  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const id = c.req.param("id");
    const input = labelPatch.parse(await c.req.json());
    const [current] = await db.select().from(gmailLabels).where(and(eq(gmailLabels.userId, userId), eq(gmailLabels.gmailLabelId, id)));
    if (!current) throw new HTTPException(404, { message: "Label not found" });
    const account = await accountOf(db, userId);
    const name = input.name ?? current.name;
    const color = input.color !== undefined ? input.color : current.backgroundColor ? { backgroundColor: current.backgroundColor, textColor: current.textColor! } : null;
    if (account?.refreshTokenEnc) {
      await updateLabel(await accessTokenFor(c.env, account), id, { ...(input.name ? { name } : {}), ...(input.color ? { color: input.color } : {}) }).catch(permissionError);
    }
    await saveLocal(db, userId, { id, name, color });
    const summary = input.name && input.name !== current.name ? `Label renamed from "${current.name}"` : "Label colour changed";
    await db.insert(events).values({ userId, entityType: "email", action: "label.updated", summary, detail: { subject: name } });
    return c.json({ ok: true });
  })

  // Deleting a label in Gmail removes it from every email that has it; the emails themselves stay.
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const id = c.req.param("id");
    const [current] = await db.select().from(gmailLabels).where(and(eq(gmailLabels.userId, userId), eq(gmailLabels.gmailLabelId, id)));
    if (!current) throw new HTTPException(404, { message: "Label not found" });
    const account = await accountOf(db, userId);
    if (account?.refreshTokenEnc) await deleteLabel(await accessTokenFor(c.env, account), id).catch(permissionError);
    await db.delete(gmailLabels).where(and(eq(gmailLabels.userId, userId), eq(gmailLabels.gmailLabelId, id)));
    await db.update(emailThreads).set({ labelIds: sql`array_remove(${emailThreads.labelIds}, ${id})` }).where(eq(emailThreads.userId, userId));
    // Tasks without an email and reports keep labels in WorkDesk; take it off those too.
    await db.update(tasks).set({ labelIds: sql`array_remove(${tasks.labelIds}, ${id})` }).where(and(eq(tasks.userId, userId), sql`${id} = any(${tasks.labelIds})`));
    await db.update(reports).set({ labelIds: sql`array_remove(${reports.labelIds}, ${id})` }).where(and(eq(reports.userId, userId), sql`${id} = any(${reports.labelIds})`));
    await db.insert(events).values({ userId, entityType: "email", action: "label.deleted", summary: "Label deleted in Gmail (emails kept)", detail: { subject: current.name } });
    // A deleted label can't stay the task / done label.
    await clearMissingTaskLabels(db, userId);
    return c.json({ ok: true });
  });

// Put labels on / take labels off one conversation (mounted under /threads).
export const threadLabelRoute = new Hono<AppEnv>().put("/:id/labels", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const { add, remove } = threadLabelsInput.parse(await c.req.json());
  const [t] = await db.select().from(emailThreads).where(and(eq(emailThreads.id, c.req.param("id")), eq(emailThreads.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Email not found" });
  const known = new Set((await listLocal(db, userId)).map((l) => l.id));
  if (![...add, ...remove].every((id) => known.has(id))) throw new HTTPException(400, { message: "Unknown label" });
  if (t.accountId) {
    const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, t.accountId));
    await setThreadLabels(await accessTokenFor(c.env, account!), t.gmailThreadId, add, remove).catch(permissionError);
  }
  await applyLabelOps(db, userId, [
    ...add.map((labelId) => ({ threadId: t.gmailThreadId, labelId, add: true })),
    ...remove.map((labelId) => ({ threadId: t.gmailThreadId, labelId, add: false })),
  ]);
  await db.insert(events).values({ userId, entityType: "email", entityId: t.id, action: "email.labels_changed", summary: "Labels changed (in Gmail too)", detail: { subject: t.subject } });
  // Adding the task / done label here makes it a task (or completes it), same as in Gmail.
  await runLabelRules(db, c.env, userId, [t.gmailThreadId]);
  return c.json({ ok: true });
});
