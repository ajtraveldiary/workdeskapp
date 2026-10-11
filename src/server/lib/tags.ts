// Tags (user request 2026-10-11): checking the ids a task or reminder is given, and finding or making tags by name
// (CSV import). WorkDesk-only; Gmail is never involved.
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import { events, tags } from "../db/schema";
import { nextTagColor, tagKey, tidyTagName } from "../../shared/tags";

// The ids, each once, in the order given; refuses ids that aren't this user's tags.
export async function checkTags(db: DB, userId: string, ids: string[] | undefined): Promise<string[] | undefined> {
  if (ids === undefined) return undefined;
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.userId, userId), inArray(tags.id, unique)));
  if (found.length !== unique.length) throw new HTTPException(400, { message: "Unknown tag" });
  return unique;
}

// Ids for these names, making the ones that don't exist yet (next colour round the palette). Keyed by lower-case name.
export async function ensureTagsByName(db: DB, userId: string, names: string[]): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const n of names) if (tidyTagName(n)) wanted.set(tagKey(n), tidyTagName(n));
  const all = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId));
  const byKey = new Map(all.map((t) => [tagKey(t.name), t.id]));
  const missing = [...wanted].filter(([k]) => !byKey.has(k));
  if (missing.length) {
    const made = await db
      .insert(tags)
      .values(missing.map(([, name], i) => ({ userId, name, color: nextTagColor(all.length + i), sortOrder: all.length + i })))
      .onConflictDoNothing()
      .returning({ id: tags.id, name: tags.name });
    for (const t of made) byKey.set(tagKey(t.name), t.id);
    await db.insert(events).values(made.map((t) => ({ userId, entityType: "sync" as const, action: "tags.created", summary: `Tag created: ${t.name}` })));
  }
  return byKey;
}

// Names by id, for the CSV export.
export async function tagNames(db: DB, userId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId));
  return new Map(rows.map((t) => [t.id, t.name]));
}

// SQL: does a tag on this list have a name containing the search text? (search by tag name)
export const tagNameMatches = (tagIdsColumn: unknown, like: string) =>
  sql`exists (select 1 from ${tags} where ${tags.id} = any(${tagIdsColumn}) and ${tags.name} ilike ${like})`;
