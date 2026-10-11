// Tags for tasks and reminders (user request 2026-10-11): made once and reused. Creating a name that already
// exists (whatever its capitals) returns that tag. Deleting one takes it off every task and reminder; they stay.
// WorkDesk-only (Gmail is never touched). Changes to the list go in History.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { events, reports, tags, tasks } from "../db/schema";
import { orderInput, tagInput, tagPatch } from "../../shared/schemas";
import type { Tag } from "../../shared/types";
import { nextTagColor } from "../../shared/tags";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });

async function load(db: DB, userId: string, id: string) {
  const [t] = await db.select().from(tags).where(and(eq(tags.id, id), eq(tags.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Tag not found" });
  return t;
}
const sameName = (userId: string, name: string, exceptId?: string) =>
  and(eq(tags.userId, userId), sql`lower(${tags.name}) = lower(${name})`, exceptId ? ne(tags.id, exceptId) : undefined);

export const tagRoutes = new Hono<AppEnv>()
  // In the user's order, each with how many open tasks and reminders use it.
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [list, taskUse, reminderUse] = await Promise.all([
      db.select().from(tags).where(eq(tags.userId, userId)).orderBy(asc(tags.sortOrder), asc(tags.name)),
      db
        .select({ id: sql<string>`unnest(${tasks.tagIds})`.as("id"), n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.status, "open")))
        .groupBy(sql`1`),
      db
        .select({ id: sql<string>`unnest(${reports.tagIds})`.as("id"), n: sql<number>`count(*)::int` })
        .from(reports)
        .where(eq(reports.userId, userId))
        .groupBy(sql`1`),
    ]);
    const t = new Map(taskUse.map((r) => [r.id, r.n]));
    const r = new Map(reminderUse.map((x) => [x.id, x.n]));
    const result: Tag[] = list.map((x) => ({ id: x.id, name: x.name, color: x.color as Tag["color"], sortOrder: x.sortOrder, tasks: t.get(x.id) ?? 0, reminders: r.get(x.id) ?? 0 }));
    return c.json({ tags: result });
  })

  // Makes a tag, or returns the one with the same name (so typing an existing name reuses it).
  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = tagInput.parse(await c.req.json());
    const [existing] = await db.select().from(tags).where(sameName(userId, input.name));
    if (existing) return c.json({ id: existing.id, name: existing.name, color: existing.color });
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(tags).where(eq(tags.userId, userId))) as [{ n: number }];
    const [t] = await db.insert(tags).values({ name: input.name, color: input.color ?? nextTagColor(n), userId, sortOrder: n }).onConflictDoNothing().returning();
    if (!t) {
      // Made at the same moment elsewhere: use that one.
      const [again] = await db.select().from(tags).where(sameName(userId, input.name));
      return c.json({ id: again!.id, name: again!.name, color: again!.color });
    }
    await log(db, userId, "tags.created", `Tag created: ${t.name}`);
    return c.json({ id: t.id, name: t.name, color: t.color }, 201);
  })

  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await load(db, userId, c.req.param("id"));
    const input = tagPatch.parse(await c.req.json());
    if (input.name !== undefined) {
      const [dup] = await db.select({ name: tags.name }).from(tags).where(sameName(userId, input.name, t.id));
      if (dup) throw new HTTPException(409, { message: `There is already a tag called ${dup.name}` });
    }
    await db.update(tags).set(input).where(eq(tags.id, t.id));
    if (input.name !== undefined && input.name !== t.name) await log(db, userId, "tags.renamed", `Tag renamed: ${t.name} → ${input.name}`);
    return c.json({ ok: true });
  })

  // Taken off every task and reminder first; the tasks and reminders themselves stay.
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await load(db, userId, c.req.param("id"));
    await db.update(tasks).set({ tagIds: sql`array_remove(${tasks.tagIds}, ${t.id}::uuid)` }).where(and(eq(tasks.userId, userId), sql`${t.id}::uuid = any(${tasks.tagIds})`));
    await db.update(reports).set({ tagIds: sql`array_remove(${reports.tagIds}, ${t.id}::uuid)` }).where(and(eq(reports.userId, userId), sql`${t.id}::uuid = any(${reports.tagIds})`));
    await db.delete(tags).where(eq(tags.id, t.id));
    await log(db, userId, "tags.deleted", `Tag deleted: ${t.name} (tasks and reminders kept)`);
    return c.json({ ok: true });
  })

  // Drag and drop in Settings > Tags: the whole order (ids not sent keep their places after).
  .post("/order", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { ids } = orderInput.parse(await c.req.json());
    const list = await db.select({ id: tags.id, sortOrder: tags.sortOrder }).from(tags).where(eq(tags.userId, userId)).orderBy(asc(tags.sortOrder), asc(tags.name));
    const have = new Set(list.map((r) => r.id));
    const first = [...new Set(ids)].filter((id) => have.has(id));
    const order = [...first, ...list.map((r) => r.id).filter((id) => !first.includes(id))];
    const was = new Map(list.map((r) => [r.id, r.sortOrder]));
    const changed = order.map((id, k) => ({ id, k })).filter(({ id, k }) => was.get(id) !== k);
    if (changed.length) {
      const cases = sql.join(changed.map(({ id, k }) => sql`when ${id}::uuid then ${k}::int`), sql` `);
      await db.update(tags).set({ sortOrder: sql`case ${tags.id} ${cases} end` }).where(and(eq(tags.userId, userId), inArray(tags.id, changed.map((x) => x.id))));
      await log(db, userId, "tags.ordered", "Tags rearranged");
    }
    return c.json({ ok: true });
  });
