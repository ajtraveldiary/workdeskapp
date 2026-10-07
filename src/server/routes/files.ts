// File register (user request 2026-10-07): the office's old physical files (no number of their own) and
// e-files (subject and e-file number). Only WorkDesk's database changes; History records each change.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { events, officeFiles } from "../db/schema";
import { officeFileInput } from "../../shared/schemas";
import type { OfficeFile } from "../../shared/types";

const toFile = (f: typeof officeFiles.$inferSelect): OfficeFile => ({
  id: f.id,
  subject: f.subject,
  physical: f.physical,
  efileNumber: f.efileNumber,
  notes: f.notes,
  updatedAt: f.updatedAt.toISOString(),
});
const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });
const label = (f: { subject: string; efileNumber: string }) => (f.efileNumber ? `${f.subject} (e-file ${f.efileNumber})` : f.subject);

// One e-file number belongs to one file: a second entry with the same number is refused, naming the first.
async function checkUnique(db: DB, userId: string, efileNumber: string, exceptId?: string) {
  if (!efileNumber) return;
  const [dup] = await db
    .select({ subject: officeFiles.subject })
    .from(officeFiles)
    .where(and(eq(officeFiles.userId, userId), sql`lower(${officeFiles.efileNumber}) = lower(${efileNumber})`, exceptId ? ne(officeFiles.id, exceptId) : undefined));
  if (dup) throw new HTTPException(409, { message: `E-file ${efileNumber} is already in the register: ${dup.subject}` });
}

async function load(db: DB, userId: string, id: string) {
  const [f] = await db.select().from(officeFiles).where(and(eq(officeFiles.id, id), eq(officeFiles.userId, userId)));
  if (!f) throw new HTTPException(404, { message: "File not found" });
  return f;
}

export const fileRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.get("db").select().from(officeFiles).where(eq(officeFiles.userId, c.get("userId"))).orderBy(asc(officeFiles.subject));
    return c.json({ files: rows.map(toFile) });
  })
  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = officeFileInput.parse(await c.req.json());
    await checkUnique(db, userId, input.efileNumber);
    const [f] = await db.insert(officeFiles).values({ ...input, userId }).returning();
    await log(db, userId, "files.added", `File added to the register: ${label(f!)}`);
    return c.json(toFile(f!), 201);
  })
  .put("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const f = await load(db, userId, c.req.param("id"));
    const input = officeFileInput.parse(await c.req.json());
    await checkUnique(db, userId, input.efileNumber, f.id);
    await db.update(officeFiles).set({ ...input, updatedAt: new Date() }).where(eq(officeFiles.id, f.id));
    const created = !f.efileNumber && !!input.efileNumber;
    await log(db, userId, created ? "files.efile_created" : "files.changed", created ? `E-file ${input.efileNumber} noted for ${input.subject}` : `File register entry changed: ${label(input)}`);
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const f = await load(db, userId, c.req.param("id"));
    await db.delete(officeFiles).where(eq(officeFiles.id, f.id));
    await log(db, userId, "files.removed", `File removed from the register: ${label(f)}`);
    return c.json({ ok: true });
  });
