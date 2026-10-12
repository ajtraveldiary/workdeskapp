// Types of events (user request 2026-10-12, "add, edit or delete event types in Settings"): Meeting, Training,
// Programme… Mounted at /api/event-types; edited in Settings > Events, chosen in the event form. Add, rename,
// arrange by drag and drop, add the usual ones, and delete — also when events have it: they stay and are shown
// as "Event" (the column is ON DELETE SET NULL). Every change goes in History.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, eq, max } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { eventTypes, events, officeEvents } from "../db/schema";
import { designationInput, orderInput } from "../../shared/schemas";
import { DEFAULT_EVENT_TYPES } from "../../shared/eventSchedule";
import type { EventType } from "../../shared/types";
import { saveOrder } from "./staff";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function load(db: DB, userId: string, id: string) {
  const [t] = await db.select().from(eventTypes).where(and(eq(eventTypes.id, id), eq(eventTypes.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Event type not found" });
  return t;
}

// The same name (whatever its capitals) can't be there twice.
async function checkName(db: DB, userId: string, name: string, except?: string) {
  const list = await db.select({ id: eventTypes.id, name: eventTypes.name }).from(eventTypes).where(eq(eventTypes.userId, userId));
  const clash = list.find((t) => t.id !== except && t.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) throw new HTTPException(409, { message: `There is already a type called ${clash.name}` });
}

export const eventTypeRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [list, used] = await Promise.all([
      db.select().from(eventTypes).where(eq(eventTypes.userId, userId)).orderBy(asc(eventTypes.sortOrder), asc(eventTypes.name)),
      db.select({ typeId: officeEvents.typeId, n: count() }).from(officeEvents).where(eq(officeEvents.userId, userId)).groupBy(officeEvents.typeId),
    ]);
    const n = new Map(used.map((u) => [u.typeId, Number(u.n)]));
    return c.json({ types: list.map((t): EventType => ({ id: t.id, name: t.name, sortOrder: t.sortOrder, events: n.get(t.id) ?? 0 })) });
  })
  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { name } = designationInput.parse(await c.req.json());
    await checkName(db, userId, name);
    const [m] = await db.select({ m: max(eventTypes.sortOrder) }).from(eventTypes).where(eq(eventTypes.userId, userId));
    const [t] = await db.insert(eventTypes).values({ userId, name, sortOrder: (m?.m ?? 0) + 1 }).returning();
    await log(db, userId, "event_types.added", `Event type added: ${name}`);
    return c.json(t, 201);
  })
  // Meeting, Training, Programme; ones already there (same name) are skipped.
  .post("/common", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const have = await db.select({ name: eventTypes.name, sortOrder: eventTypes.sortOrder }).from(eventTypes).where(eq(eventTypes.userId, userId));
    const names = new Set(have.map((t) => t.name.trim().toLowerCase()));
    const start = Math.max(0, ...have.map((t) => t.sortOrder)) + 1;
    const add = DEFAULT_EVENT_TYPES.filter((n) => !names.has(n.toLowerCase()));
    if (add.length) {
      await db.insert(eventTypes).values(add.map((name, i) => ({ userId, name, sortOrder: start + i })));
      await log(db, userId, "event_types.common", `Added ${plural(add.length, "event type")}`);
    }
    return c.json({ added: add.length });
  })
  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await load(db, userId, c.req.param("id"));
    const { name } = designationInput.parse(await c.req.json());
    await checkName(db, userId, name, t.id);
    await db.update(eventTypes).set({ name }).where(eq(eventTypes.id, t.id));
    if (name !== t.name) await log(db, userId, "event_types.renamed", `Event type renamed: ${t.name} → ${name}`);
    return c.json({ ok: true });
  })
  .post("/order", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { ids } = orderInput.parse(await c.req.json());
    if (await saveOrder(db, eventTypes, userId, ids)) await log(db, userId, "event_types.ordered", "Event types rearranged");
    return c.json({ ok: true });
  })
  // Its events stay, without a type.
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await load(db, userId, c.req.param("id"));
    const [u] = await db.select({ n: count() }).from(officeEvents).where(eq(officeEvents.typeId, t.id));
    const n = Number(u?.n ?? 0);
    await db.delete(eventTypes).where(eq(eventTypes.id, t.id));
    await log(db, userId, "event_types.removed", `Event type removed: ${t.name}${n ? ` (${plural(n, "event")} kept, now without a type)` : ""}`);
    return c.json({ ok: true });
  });
