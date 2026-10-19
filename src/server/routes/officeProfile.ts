// Office details (user request 2026-10-19, Settings › General): read with the defaults filled in when nothing is
// saved yet, and saved whole (the form sends every field). Each save writes a History entry. Assistants read them
// through get_settings to draft complete official letters.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../app";
import { events, officeProfiles } from "../db/schema";
import { officeProfileInput, type OfficeProfile } from "../../shared/schemas";

export const EMPTY_OFFICE_PROFILE: OfficeProfile = officeProfileInput.parse({});

export const officeProfileRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const [row] = await c.get("db").select().from(officeProfiles).where(eq(officeProfiles.userId, c.get("userId")));
    // A saved copy from before a field was added still gets every field.
    return c.json({ profile: officeProfileInput.parse(row?.data ?? {}) as OfficeProfile, updatedAt: row?.updatedAt.toISOString() ?? null });
  })
  .put("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const data = officeProfileInput.parse(await c.req.json());
    await db
      .insert(officeProfiles)
      .values({ userId, data })
      .onConflictDoUpdate({ target: officeProfiles.userId, set: { data, updatedAt: new Date() } });
    await db.insert(events).values({ userId, entityType: "sync", action: "settings.office_profile", summary: `Office details saved${data.officeName ? `: ${data.officeName}` : ""}` });
    return c.json({ ok: true });
  });
