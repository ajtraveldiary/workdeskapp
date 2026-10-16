// Registers (user request 2026-10-16): the office's registers, added in Settings › Registers (`/api/registers`), and
// the pending updates to them (`/api/register-entries`): what to write and the employee who has to sign it or give
// what is needed. Entries are not tasks unless given a due date; then the entry has a task (For that employee) and
// the two stay in step both ways (lib/registers.ts). Done entries are kept. Only WorkDesk's database changes;
// every change goes in History.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { employees, events, registerEntries, registers, tasks } from "../db/schema";
import { designationInput, entryInput, entryPatch, orderInput, registerPatch } from "../../shared/schemas";
import { dayLabel } from "../../shared/reminderSchedule";
import type { Register, RegisterEntry } from "../../shared/types";
import { saveOrder } from "./staff";
import { entryTaskTitle, taskFollowsEntry } from "../lib/registers";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });

async function loadRegister(db: DB, userId: string, id: string) {
  const [r] = await db.select().from(registers).where(and(eq(registers.id, id), eq(registers.userId, userId)));
  if (!r) throw new HTTPException(404, { message: "Register not found" });
  return r;
}
async function checkName(db: DB, userId: string, name: string, except?: string) {
  const list = await db.select({ id: registers.id, name: registers.name }).from(registers).where(eq(registers.userId, userId));
  const clash = list.find((r) => r.id !== except && r.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) throw new HTTPException(409, { message: `There is already a register called ${clash.name}` });
}
async function checkEmployee(db: DB, userId: string, id: string | null | undefined) {
  if (!id) return;
  const [e] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), eq(employees.userId, userId)));
  if (!e) throw new HTTPException(400, { message: "Unknown employee" });
}

export const registerRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [list, counts] = await Promise.all([
      db.select().from(registers).where(eq(registers.userId, userId)).orderBy(asc(registers.sortOrder), asc(registers.name)),
      db.select({ registerId: registerEntries.registerId, status: registerEntries.status, n: count() }).from(registerEntries).where(eq(registerEntries.userId, userId)).groupBy(registerEntries.registerId, registerEntries.status),
    ]);
    const n = (id: string, status: "open" | "done") => Number(counts.find((x) => x.registerId === id && x.status === status)?.n ?? 0);
    return c.json({ registers: list.map((r): Register => ({ id: r.id, name: r.name, sortOrder: r.sortOrder, updatedUntil: r.updatedUntil, open: n(r.id, "open"), done: n(r.id, "done") })) });
  })
  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { name } = designationInput.parse(await c.req.json());
    await checkName(db, userId, name);
    const [m] = await db.select({ m: max(registers.sortOrder) }).from(registers).where(eq(registers.userId, userId));
    const [r] = await db.insert(registers).values({ userId, name, sortOrder: (m?.m ?? 0) + 1 }).returning();
    await log(db, userId, "registers.added", `Register added: ${name}`);
    return c.json(r, 201);
  })
  // Rename, or set the date it is updated until (null clears it).
  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const r = await loadRegister(db, userId, c.req.param("id"));
    const input = registerPatch.parse(await c.req.json());
    if (input.name !== undefined) await checkName(db, userId, input.name, r.id);
    await db.update(registers).set(input).where(eq(registers.id, r.id));
    if (input.name !== undefined && input.name !== r.name) await log(db, userId, "registers.renamed", `Register renamed: ${r.name} → ${input.name}`);
    if (input.updatedUntil !== undefined && input.updatedUntil !== r.updatedUntil)
      await log(db, userId, "registers.updated_until", input.updatedUntil ? `${input.name ?? r.name} updated until ${dayLabel(input.updatedUntil)}` : `${input.name ?? r.name}: updated-until date removed`);
    return c.json({ ok: true });
  })
  .post("/order", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { ids } = orderInput.parse(await c.req.json());
    if (await saveOrder(db, registers, userId, ids)) await log(db, userId, "registers.ordered", "Registers rearranged");
    return c.json({ ok: true });
  })
  // Its entries go with it, and their open tasks (completed ones stay).
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const r = await loadRegister(db, userId, c.req.param("id"));
    const entries = await db.select({ taskId: registerEntries.taskId }).from(registerEntries).where(eq(registerEntries.registerId, r.id));
    const taskIds = entries.map((e) => e.taskId).filter((x): x is string => !!x);
    if (taskIds.length) await db.delete(tasks).where(and(inArray(tasks.id, taskIds), eq(tasks.status, "open")));
    await db.delete(registers).where(eq(registers.id, r.id));
    await log(db, userId, "registers.removed", `Register removed: ${r.name}${entries.length ? ` (with ${entries.length} ${entries.length === 1 ? "entry" : "entries"})` : ""}`);
    return c.json({ ok: true });
  });

const toEntry = (e: typeof registerEntries.$inferSelect, task: { id: string; dueDate: string | null; status: "open" | "done" } | null): RegisterEntry => ({
  id: e.id,
  registerId: e.registerId,
  text: e.text,
  employeeId: e.employeeId,
  status: e.status,
  doneAt: e.doneAt?.toISOString() ?? null,
  createdAt: e.createdAt.toISOString(),
  task,
});

async function loadEntry(db: DB, userId: string, id: string) {
  const [e] = await db.select().from(registerEntries).where(and(eq(registerEntries.id, id), eq(registerEntries.userId, userId)));
  if (!e) throw new HTTPException(404, { message: "Entry not found" });
  return e;
}

// The entry's task: made, moved, renamed or taken away to match its due date (null = no task).
async function settleEntryTask(db: DB, userId: string, e: typeof registerEntries.$inferSelect, registerName: string, dueDate: string | null | undefined) {
  if (dueDate === undefined) {
    // Only the text, register or person changed: an open task follows them.
    if (!e.taskId) return e.taskId;
    await db
      .update(tasks)
      .set({ title: entryTaskTitle(registerName, e.text), relatedKind: e.employeeId ? "employee" : null, relatedId: e.employeeId, updatedAt: new Date() })
      .where(and(eq(tasks.id, e.taskId), eq(tasks.status, "open")));
    return e.taskId;
  }
  if (dueDate === null) {
    if (e.taskId) {
      await db.delete(tasks).where(and(eq(tasks.id, e.taskId), eq(tasks.status, "open")));
      await db.insert(events).values({ userId, entityType: "task", entityId: e.taskId, action: "task.deleted", summary: "Removed: its register entry has no due date now", detail: { title: entryTaskTitle(registerName, e.text) } });
    }
    return null;
  }
  if (e.taskId) {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, e.taskId));
    if (t) {
      await db
        .update(tasks)
        .set({ dueDate, title: entryTaskTitle(registerName, e.text), relatedKind: e.employeeId ? "employee" : null, relatedId: e.employeeId, updatedAt: new Date() })
        .where(eq(tasks.id, t.id));
      return t.id;
    }
  }
  const [t] = await db
    .insert(tasks)
    .values({
      userId,
      title: entryTaskTitle(registerName, e.text),
      notes: `Pending update in the ${registerName} register`,
      dueDate,
      priority: "normal",
      relatedKind: e.employeeId ? "employee" : null,
      relatedId: e.employeeId,
      ...(e.status === "done" ? { status: "done" as const, completedAt: new Date() } : {}),
    })
    .returning();
  await db.insert(events).values({ userId, entityType: "task", entityId: t!.id, action: "task.created", summary: "Made for a register entry", detail: { title: t!.title } });
  return t!.id;
}

export const entryRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const rows = await db
      .select({ e: registerEntries, taskId: tasks.id, dueDate: tasks.dueDate, taskStatus: tasks.status })
      .from(registerEntries)
      .leftJoin(tasks, eq(tasks.id, registerEntries.taskId))
      .where(eq(registerEntries.userId, userId))
      .orderBy(asc(registerEntries.status), desc(registerEntries.createdAt));
    return c.json({ entries: rows.map((r) => toEntry(r.e, r.taskId ? { id: r.taskId, dueDate: r.dueDate, status: r.taskStatus! } : null)) });
  })
  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { dueDate, ...input } = entryInput.parse(await c.req.json());
    const r = await loadRegister(db, userId, input.registerId);
    await checkEmployee(db, userId, input.employeeId);
    const [e] = await db.insert(registerEntries).values({ ...input, userId }).returning();
    const taskId = dueDate ? await settleEntryTask(db, userId, e!, r.name, dueDate) : null;
    if (taskId) await db.update(registerEntries).set({ taskId }).where(eq(registerEntries.id, e!.id));
    await log(db, userId, "registers.entry_added", `${r.name}: ${input.text}`);
    return c.json({ id: e!.id, taskId }, 201);
  })
  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEntry(db, userId, c.req.param("id"));
    const { dueDate, ...input } = entryPatch.parse(await c.req.json());
    const r = await loadRegister(db, userId, input.registerId ?? e.registerId);
    await checkEmployee(db, userId, input.employeeId);
    const [next] = await db.update(registerEntries).set({ ...input, updatedAt: new Date() }).where(eq(registerEntries.id, e.id)).returning();
    const taskId = await settleEntryTask(db, userId, next!, r.name, dueDate);
    if (taskId !== next!.taskId) await db.update(registerEntries).set({ taskId }).where(eq(registerEntries.id, e.id));
    await log(db, userId, "registers.entry_changed", `${r.name}: ${next!.text}`);
    return c.json({ ok: true });
  })
  // Ticked done or back to pending; its task follows.
  .post("/:id/done", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEntry(db, userId, c.req.param("id"));
    const { done } = (await c.req.json()) as { done: boolean };
    if (typeof done !== "boolean") throw new HTTPException(400, { message: "done must be true or false" });
    if ((e.status === "done") !== done) {
      await db
        .update(registerEntries)
        .set(done ? { status: "done", doneAt: new Date(), updatedAt: new Date() } : { status: "open", doneAt: null, updatedAt: new Date() })
        .where(eq(registerEntries.id, e.id));
      const [r] = await db.select({ name: registers.name }).from(registers).where(eq(registers.id, e.registerId));
      await log(db, userId, done ? "registers.entry_done" : "registers.entry_reopened", `${r?.name ?? "Register"}: ${e.text}${done ? " (done)" : " (pending again)"}`);
      await taskFollowsEntry(db, userId, e.taskId, done);
    }
    return c.json({ ok: true });
  })
  // Its open task goes too.
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEntry(db, userId, c.req.param("id"));
    if (e.taskId) await db.delete(tasks).where(and(eq(tasks.id, e.taskId), eq(tasks.status, "open")));
    await db.delete(registerEntries).where(eq(registerEntries.id, e.id));
    const [r] = await db.select({ name: registers.name }).from(registers).where(eq(registers.id, e.registerId));
    await log(db, userId, "registers.entry_removed", `${r?.name ?? "Register"}: ${e.text} (removed)`);
    return c.json({ ok: true });
  });
