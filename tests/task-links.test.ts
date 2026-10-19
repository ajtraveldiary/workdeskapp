// Links on tasks (user request 2026-10-19): saved with a task (also one made from an email), changed by Edit, left
// alone by changes that don't send them, only http(s) links, shown to assistants.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Task, Thread } from "../src/shared/types";

describe("task links", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
  };
  const task = async (id: string) => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.id === id)!;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("keeps links with a task and changes them only when sent", async () => {
    const sheet = { url: "https://docs.google.com/spreadsheets/d/abc", name: "2026-27 സാമ്പത്തിക വർഷത്തെ റിപ്പോർട്ട്" };
    const made = (await call("POST", "/tasks", { title: "Fill the HMIS sheet", links: [sheet] })).json as Task;
    expect((await task(made.id)).links).toEqual([sheet]);

    // Other changes leave the links alone.
    await call("PATCH", `/tasks/${made.id}`, { priority: "high" });
    expect((await task(made.id)).links).toEqual([sheet]);

    const portal = { url: "https://spark.gov.in", name: "" };
    await call("PATCH", `/tasks/${made.id}`, { links: [sheet, portal] });
    expect((await task(made.id)).links).toEqual([sheet, portal]);
    await call("PATCH", `/tasks/${made.id}`, { links: [] });
    expect((await task(made.id)).links).toEqual([]);

    // Only web links.
    expect((await call("POST", "/tasks", { title: "x", links: [{ url: "javascript:alert(1)", name: "" }] })).status).toBe(400);
    // A task without links has an empty list.
    expect((await task((await call("POST", "/tasks", { title: "No links" })).json.id)).links).toEqual([]);
  });

  it("keeps links on a task made from an email", async () => {
    const [email] = (await call("GET", "/threads?state=needs_decision")).json.threads as Thread[];
    const made = (await call("POST", `/threads/${email!.id}/task`, { title: "Reply", links: [{ url: "https://drive.google.com/file/d/xyz/view", name: "Order" }] })).json as Task;
    expect((await task(made.id)).links).toEqual([{ url: "https://drive.google.com/file/d/xyz/view", name: "Order" }]);
  });
});
