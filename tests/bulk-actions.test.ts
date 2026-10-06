// List toolbars (user request 2026-10-06): tick several emails, then make them tasks, snooze or restore them
// in one go. Gmail is never changed by these (no Google here: demo user).
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";

let app: ReturnType<typeof createApp>;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
  const text = await res.text();
  return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
};
const pending = async () => (await call("GET", "/threads?state=needs_decision")).json.threads as { id: string; subject: string }[];
const stateOf = async (id: string) => ((await call("GET", "/threads?state=all")).json.threads as { id: string; state: string }[]).find((t) => t.id === id)!.state;

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  const db = d as unknown as DB;
  app = createApp({ getDb: () => db, allowDemo: true });
});

describe("bulk email actions", () => {
  it("makes one task per ticked email, titled with its subject", async () => {
    const [a, b] = await pending();
    expect((await call("POST", "/threads/bulk-task", { ids: [a!.id, b!.id] })).json).toEqual({ created: 2 });
    const titles = ((await call("GET", "/tasks?view=any")).json.tasks as { title: string }[]).map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining([a!.subject, b!.subject]));
    expect(await stateOf(a!.id)).toBe("task");
    // Already tasks: nothing more happens.
    expect((await call("POST", "/threads/bulk-task", { ids: [a!.id] })).json).toEqual({ created: 0 });
  });

  it("snoozes ticked emails, then restores them to Pending", async () => {
    const [a, b] = await pending();
    const until = new Date(Date.now() + 86400_000).toISOString();
    expect((await call("POST", "/threads/bulk-snooze", { ids: [a!.id, b!.id], until })).json).toEqual({ snoozed: 2 });
    expect(await stateOf(b!.id)).toBe("snoozed");
    expect((await call("POST", "/threads/bulk-snooze", { ids: [a!.id], until: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    expect((await call("POST", "/threads/bulk-restore", { ids: [a!.id, b!.id] })).json).toEqual({ restored: 2 });
    expect(await stateOf(a!.id)).toBe("needs_decision");
  });
});
