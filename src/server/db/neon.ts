import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import type { DB } from "./index";

export function neonDb(url: string): DB {
  return drizzle({ client: neon(url), schema }) as unknown as DB;
}
