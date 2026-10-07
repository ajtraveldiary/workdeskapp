// Settings > Notifications (user request 2026-10-07): turn phone notifications on or off for a device, choose
// what is sent (morning summary and its time, at the due time), and send a test. Sending is in lib/notify.ts.
import { Hono } from "hono";
import { and, count, eq } from "drizzle-orm";
import type { AppEnv } from "../app";
import { events, pushSubscriptions, users } from "../db/schema";
import { pushSettingsInput, pushSubscribeInput } from "../../shared/schemas";
import { pushToUser, vapidKeysFor } from "../lib/notify";
import { z } from "zod";

export const pushRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const keys = await vapidKeysFor(db, c.env, userId);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    const [n] = await db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    return c.json({ publicKey: keys.publicKey, summaryOn: u!.pushSummaryOn, summaryTime: u!.pushSummaryTime, dueOn: u!.pushDueOn, devices: Number(n?.n ?? 0) });
  })
  // This device turned notifications on (or refreshes its subscription when the app opens).
  .post("/subscribe", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { endpoint, keys, device } = pushSubscribeInput.parse(await c.req.json());
    const [before] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, device: device ?? null })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: keys.p256dh, auth: keys.auth, device: device ?? null } });
    if (!before) await db.insert(events).values({ userId, entityType: "sync", action: "settings.push_on", summary: `Turned on phone notifications${device ? ` (${device})` : ""}` });
    return c.json({ ok: true });
  })
  .post("/unsubscribe", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(await c.req.json());
    const gone = await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });
    if (gone.length) await db.insert(events).values({ userId, entityType: "sync", action: "settings.push_off", summary: "Turned off phone notifications on a device" });
    return c.json({ ok: true });
  })
  .put("/settings", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = pushSettingsInput.parse(await c.req.json());
    await db.update(users).set({ pushSummaryOn: input.summaryOn, pushSummaryTime: input.summaryTime, pushDueOn: input.dueOn }).where(eq(users.id, userId));
    return c.json({ ok: true });
  })
  // A test notification to this device (or every device).
  .post("/test", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string };
    const sent = await pushToUser(
      c.get("db"),
      c.env,
      c.get("userId"),
      [{ title: "WorkDesk notifications are on", body: "You'll get the morning summary and a note when a timed task or reminder is due.", url: "/settings", tag: "test" }],
      typeof body.endpoint === "string" ? body.endpoint : undefined,
    );
    return c.json({ sent });
  });
