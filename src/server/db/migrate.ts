// Applies migrations in ./drizzle to Neon (when DATABASE_URL is set) or the local database.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { localDb } from "./local";

const url = process.env.DATABASE_URL;
if (url) {
  await migrate(drizzle({ client: neon(url) }), { migrationsFolder: "drizzle" });
  console.log("Migrated Neon database.");
} else {
  await localDb();
  console.log("Migrated local database in .data/pglite.");
}
