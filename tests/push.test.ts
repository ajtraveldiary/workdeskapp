// Phone notifications (user request 2026-10-07): the Web Push encryption matches the standard's worked
// example, the VAPID signature checks out, and the scheduler sends the morning summary once a day and each
// timed task once at its time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { planNotifications, sendScheduledPush, timeIn } from "../src/server/lib/notify";
import { b64url, encryptPayload, fromB64url, makeVapidKeys, vapidAuthorization } from "../src/server/lib/webpush";

describe("web push encryption", () => {
  it("matches RFC 8291's example message", async () => {
    // RFC 8291 section 5.
    const asPublic = fromB64url("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const jwk = { kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", x: b64url(asPublic.slice(1, 33)), y: b64url(asPublic.slice(33)) };
    const serverKeys = {
      privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
      publicKey: await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, true, []),
    };
    const body = await encryptPayload(
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      { salt: fromB64url("DGv6ra1nlYgDCS1FRnbzlw"), serverKeys },
    );
    expect(b64url(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("signs the VAPID token with WorkDesk's key for the push service's origin", async () => {
    const keys = await makeVapidKeys();
    const auth = await vapidAuthorization("https://web.push.apple.com/QGuQ", keys, "mailto:clerk@example.gov", 1_800_000_000_000);
    const [, token, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token!.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c!)))).toEqual({ aud: "https://web.push.apple.com", exp: 1_800_000_000 + 12 * 3600, sub: "mailto:clerk@example.gov" });
    const pub = await crypto.subtle.importKey("raw", fromB64url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(s!), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });
});

describe("notification schedule", () => {
  let db: DB;
  let userId: string;
  const env = { APP_TIMEZONE: "Asia/Kolkata" };
  const at = (hm: string) => new Date(`2026-10-08T${hm}:00+05:30`); // a time on 8 Oct in India
  const task = (title: string, extra: Partial<typeof schema.tasks.$inferInsert>) => db.insert(schema.tasks).values({ userId, title, ...extra }).returning();
  let posts: string[];
  let pushStatus = 201;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    userId = (await db.insert(schema.users).values({ email: "clerk@example.gov" }).returning())[0]!.id;
    // A device that turned notifications on (a real key pair, so the message can be encrypted for it).
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const p256dh = b64url(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer));
    await db.insert(schema.pushSubscriptions).values({ userId, endpoint: "https://web.push.apple.com/device-1", p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) });
    posts = [];
    pushStatus = 201;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        posts.push(`${String(input)} ${(init?.headers as Record<string, string>)["content-encoding"]}`);
        return new Response(null, { status: pushStatus });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tells the time in the app's timezone", () => {
    expect(timeIn("Asia/Kolkata", at("10:35"))).toBe("10:35");
  });

  it("sends the morning summary once a day and each timed task once at its time", async () => {
    await task("2026-27 സാമ്പത്തിക വർഷത്തെ 2210-ഓൺലൈൻ റീകൺസിലിയേഷൻ പൂർത്തിയാക്കി ജില്ലാ മെഡിക്കൽ ഓഫീസർക്ക് റിപ്പോർട്ട്", { dueDate: "2026-10-08", dueTime: "10:30", priority: "urgent" });
    await task("Staff meeting", { dueDate: "2026-10-08", dueTime: "10:50" });
    await task("Early call (missed long ago)", { dueDate: "2026-10-08", dueTime: "08:00" });
    await task("Cash book update", { dueDate: "2026-10-07" }); // overdue
    await task("Waiting on DMO", { dueDate: "2026-10-08", dueTime: "10:00", waitingSince: new Date() }); // waiting: no due-time note
    await task("Done already", { dueDate: "2026-10-08", dueTime: "10:20", status: "done" });

    const plan = await planNotifications(db, env, userId, at("10:35"));
    const titles = plan.messages.map((m) => m.title);
    expect(titles).toContain("2026-27 സാമ്പത്തിക വർഷത്തെ 2210-ഓൺലൈൻ റീകൺസിലിയേഷൻ പൂർത്തിയാക്കി ജില്ലാ മെഡിക്കൽ ഓഫീസർക്ക് റിപ്പോർട്ട്");
    expect(titles).toContain("Today: 3 due · 1 overdue");
    expect(titles).toHaveLength(2); // not the 10:50 one yet, not the missed 08:00 one, not the waiting or done ones
    expect(plan.messages.every((m) => m.badge === 4)).toBe(true);
    expect(plan.messages.find((m) => m.tag === "summary")!.body).toContain("Cash book update (overdue)");

    await sendScheduledPush(db, env, at("10:35"));
    expect(posts).toEqual(["https://web.push.apple.com/device-1 aes128gcm", "https://web.push.apple.com/device-1 aes128gcm"]);
    // Ten minutes later: nothing new. At 10:55 the 10:50 meeting.
    await sendScheduledPush(db, env, at("10:45"));
    expect(posts).toHaveLength(2);
    expect((await planNotifications(db, env, userId, at("10:55"))).messages.map((m) => m.title)).toEqual(["Staff meeting"]);
  });

  it("respects the settings: no summary before its time or when off, no due notes when off", async () => {
    await task("Staff meeting", { dueDate: "2026-10-08", dueTime: "09:00" });
    await db.update(schema.users).set({ pushSummaryTime: "11:00" }).where(eq(schema.users.id, userId));
    expect((await planNotifications(db, env, userId, at("09:05"))).messages.map((m) => m.title)).toEqual(["Staff meeting"]);
    await db.update(schema.users).set({ pushDueOn: false, pushSummaryOn: false }).where(eq(schema.users.id, userId));
    expect((await planNotifications(db, env, userId, at("11:05"))).messages).toEqual([]);
  });

  it("forgets a device that turned notifications off", async () => {
    pushStatus = 410;
    await task("Staff meeting", { dueDate: "2026-10-08", dueTime: "10:30" });
    await sendScheduledPush(db, env, at("10:35"));
    expect(await db.select().from(schema.pushSubscriptions)).toEqual([]);
  });
});
