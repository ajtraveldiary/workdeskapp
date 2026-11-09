// Staff (user request 2026-10-07): checks what a task or reminder is said to be about, and names it for History.
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import { designations, employees } from "../db/schema";
import type { RelatedKind } from "../../shared/staff";

export type Related = { relatedKind: RelatedKind | null; relatedId: string | null };

// The pair as stored: an employee or designation of this user, "office" with no id, or nothing. Throws 400
// for an employee or designation that isn't theirs.
export async function checkRelated(db: DB, userId: string, kind: RelatedKind | null | undefined, id: string | null | undefined): Promise<Related> {
  if (!kind) return { relatedKind: null, relatedId: null };
  if (kind === "office") return { relatedKind: "office", relatedId: null };
  if (!id) throw new HTTPException(400, { message: `Choose the ${kind}` });
  const table = kind === "employee" ? employees : designations;
  const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.userId, userId)));
  if (!row) throw new HTTPException(400, { message: `Unknown ${kind}` });
  return { relatedKind: kind, relatedId: id };
}

export async function relatedName(db: DB, r: Related): Promise<string> {
  if (r.relatedKind === "office") return "General office";
  if (!r.relatedKind || !r.relatedId) return "nothing";
  if (r.relatedKind === "employee") {
    const [e] = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, r.relatedId));
    return e?.name ?? "an employee";
  }
  const [d] = await db.select({ name: designations.name }).from(designations).where(eq(designations.id, r.relatedId));
  return d ? `${d.name} (all)` : "a designation";
}

// Day off and Gazetted by designation (user request 2026-11-10): `offDayIds` / `gazettedIds` are employees whose value
// was just given (the CSV import): each becomes an individual exception when it differs from their post. Then every
// employee who follows their post (not set individually) takes the post's day off and, if permanent, its gazetted
// tick; with no designation, Sunday off and not gazetted.
export async function applyPostSettings(db: DB, userId: string, offDayIds: string[] = [], gazettedIds: string[] = []) {
  const post = (col: "off_day" | "gazetted", fallback: string) => sql.raw(`coalesce((select d.${col} from designations d where d.id = employees.designation_id), ${fallback})`);
  if (offDayIds.length)
    await db.update(employees).set({ offDayOwn: sql`${employees.offDay} <> ${post("off_day", "'sunday'")}` }).where(and(eq(employees.userId, userId), inArray(employees.id, offDayIds)));
  if (gazettedIds.length)
    await db
      .update(employees)
      .set({ gazettedOwn: sql`${employees.permanent} and ${employees.gazetted} <> ${post("gazetted", "false")}` })
      .where(and(eq(employees.userId, userId), inArray(employees.id, gazettedIds)));
  await db.update(employees).set({ offDay: sql`${post("off_day", "'sunday'")}` }).where(and(eq(employees.userId, userId), eq(employees.offDayOwn, false)));
  await db
    .update(employees)
    .set({ gazetted: sql`${employees.permanent} and ${post("gazetted", "false")}` })
    .where(and(eq(employees.userId, userId), eq(employees.gazettedOwn, false)));
}
