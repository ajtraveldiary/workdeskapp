import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

// Both the Neon (production) and PGlite (local) drivers satisfy this type.
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
