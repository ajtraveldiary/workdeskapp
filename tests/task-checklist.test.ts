// Checklists inside a task (user request 2026-10-07): saved with the task, ticked one by one, kept by other edits.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Task } from "../src/shared/types";

describe("task checklist", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const find = async (id: string) => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.id === id)!;
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("saves the steps, ticks them and keeps them through other edits", async () => {
    const steps = [
      { id: "a", text: "Prepare draft", done: false },
      { id: "b", text: "Get signature", done: false },
    ];
    const created = await call("POST", "/tasks", { title: "Relieving order", checklist: steps });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    expect((await find(id)).checklist).toEqual(steps);

    await call("PATCH", `/tasks/${id}`, { checklist: [{ ...steps[0], done: true }, steps[1]] });
    expect((await find(id)).checklist.map((s) => s.done)).toEqual([true, false]);
    // Changing something else leaves the steps alone.
    await call("PATCH", `/tasks/${id}`, { priority: "high" });
    expect((await find(id)).checklist).toHaveLength(2);

    // Tasks without a checklist get an empty one; empty steps are refused.
    const plain = await call("POST", "/tasks", { title: "Plain task" });
    expect((await find(plain.json.id)).checklist).toEqual([]);
    expect((await call("PATCH", `/tasks/${id}`, { checklist: [{ id: "c", text: "  ", done: false }] })).status).toBe(400);
  });
});
