import type { DB } from "../db";
import { events } from "../db/schema";

type NewEvent = Omit<typeof events.$inferInsert, "id" | "createdAt">;

export async function logEvent(db: DB, e: NewEvent) {
  await db.insert(events).values(e);
}
