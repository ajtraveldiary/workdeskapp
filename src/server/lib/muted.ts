import { sql } from "drizzle-orm";
import { mutedSenders } from "../db/schema";

// True when a conversation's latest sender is on the user's "hide from Pending" list, either the exact
// address or its "@domain". Applied when listing and counting, so nothing is changed on the email itself
// and removing an entry brings its emails straight back to Pending.
// Columns are written out with their table name: in a select list Drizzle leaves the table off, which
// would make "user_id" ambiguous inside the sub-query.
export const isMuted = sql<boolean>`exists (
  select 1 from ${mutedSenders} m
  where m.user_id = email_threads.user_id
    and (lower(email_threads.from_email) = m.pattern
      or (left(m.pattern, 1) = '@' and lower(email_threads.from_email) like '%' || m.pattern))
)`;

export const notMuted = sql<boolean>`not ${isMuted}`;
