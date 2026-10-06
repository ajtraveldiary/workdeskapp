// Categories were merged into Gmail labels (2026-10-06). A task from an email shows its email's Gmail labels;
// tasks without an email keep labels in WorkDesk. Filters and deleting a label follow. (Reminders, formerly
// reports, have no labels since 2026-10-06; see reminders.test.ts.)
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

let labelA: string;
let labelB: string;

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  const db = d as unknown as DB;
  app = createApp({ getDb: () => db, allowDemo: true }); // demo user, demo labels, no Google needed
  const { json } = await call("GET", "/labels");
  [labelA, labelB] = json.labels.map((l: { id: string }) => l.id);
});

// A demo email turned into a task.
const emailTask = async () => {
  const { json } = await call("GET", "/threads?state=needs_decision");
  const thread = json.threads[0];
  const { json: task } = await call("POST", `/threads/${thread.id}/task`, { title: thread.subject });
  return { thread, task };
};

const anyTasks = async (query = "") => (await call("GET", `/tasks?view=any${query}`)).json.tasks as { id: string; title: string; labelIds: string[]; thread: unknown }[];

describe("labels on tasks", () => {
  it("there are no categories any more", async () => {
    expect((await call("GET", "/categories")).status).toBe(404);
  });

  it("a task made by hand keeps its own labels, changed only when sent", async () => {
    const { json: created } = await call("POST", "/tasks", { title: "Stock register check", labelIds: [labelA] });
    expect((await anyTasks()).find((t) => t.id === created.id)!.labelIds).toEqual([labelA]);
    await call("PATCH", `/tasks/${created.id}`, { priority: "high" });
    expect((await anyTasks()).find((t) => t.id === created.id)!.labelIds).toEqual([labelA]);
    await call("PATCH", `/tasks/${created.id}`, { labelIds: [labelA, labelB] });
    expect((await anyTasks()).find((t) => t.id === created.id)!.labelIds).toEqual([labelA, labelB]);
  });

  it("system labels can't be put on a task", async () => {
    expect((await call("POST", "/tasks", { title: "x", labelIds: ["INBOX"] })).status).toBe(400);
  });

  it("a task from an email shows the email's labels and can't take its own", async () => {
    const { thread, task: created } = await emailTask();
    await call("PUT", `/threads/${thread.id}/labels`, { add: [labelB], remove: [] });
    const task = (await anyTasks()).find((t) => t.id === created.id)!;
    expect(task.labelIds).toContain(labelB);
    expect((await call("PATCH", `/tasks/${task.id}`, { labelIds: [labelA] })).status).toBe(400);
  });

  it("filters by label, for tasks with and without an email", async () => {
    const { json: manual } = await call("POST", "/tasks", { title: "Filtered by hand", labelIds: [labelA] });
    const { thread, task } = await emailTask();
    await call("PUT", `/threads/${thread.id}/labels`, { add: [labelA], remove: [] });
    const ids = (await anyTasks(`&label=${labelA}`)).map((t) => t.id);
    expect(ids).toContain(manual.id);
    expect(ids).toContain(task.id);
    expect((await call("GET", `/threads?state=all&label=${labelA}`)).json.threads.map((t: { id: string }) => t.id)).toContain(thread.id);
  });

  it("deleting a label takes it off tasks too", async () => {
    const { json: task } = await call("POST", "/tasks", { title: "Loses a label", labelIds: [labelA, labelB] });
    await call("DELETE", `/labels/${labelA}`);
    expect((await anyTasks()).find((t) => t.id === task.id)!.labelIds).toEqual([labelB]);
  });
});
