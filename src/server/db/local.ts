import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import type { DB } from "./index";

// Local development database stored in ./.data (no Postgres install needed).
export async function localDb(): Promise<DB> {
  mkdirSync(".data", { recursive: true });
  const db = drizzle({ client: new PGlite(".data/pglite"), schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}
