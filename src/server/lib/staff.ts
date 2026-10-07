// Staff (user request 2026-10-07): checks what a task or reminder is said to be about, and names it for History.
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
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
