// Updates (tasks, reminders, labels) change only the fields they include; they used to reset the rest to defaults.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { taskPatch } from "../src/shared/schemas";

let app: ReturnType<typeof createApp>;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
  return { status: res.status, json: (await res.json()) as any };
};

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  const db = d as unknown as DB;
  app = createApp({ getDb: () => db, allowDemo: true }); // demo user, no Google needed
});

describe("task updates", () => {
  it("the update schema keeps only the fields sent", () => {
    expect(taskPatch.parse({ priority: "high" })).toEqual({ priority: "high" });
  });

  it("changing one field leaves the others untouched", async () => {
    const { json: created } = await call("POST", "/tasks", {
      title: "Submit HMIS report",
      notes: "Ask the data entry operator",
      dueDate: "2026-10-11",
      dueTime: "10:30",
      priority: "normal",
    });
    expect((await call("PATCH", `/tasks/${created.id}`, { priority: "urgent" })).status).toBe(200);
    expect((await call("PATCH", `/tasks/${created.id}`, { title: "Submit HMIS report (Sept)" })).status).toBe(200);

    const { json } = await call("GET", "/tasks?view=any");
    const t = json.tasks.find((x: { id: string }) => x.id === created.id);
    expect(t).toMatchObject({
      title: "Submit HMIS report (Sept)",
      notes: "Ask the data entry operator",
      dueDate: "2026-10-11",
      dueTime: "10:30",
      priority: "urgent",
    });
  });

  it("removing the due date also removes its time", async () => {
    const { json: created } = await call("POST", "/tasks", { title: "Call MO", dueDate: "2026-10-11", dueTime: "09:00" });
    await call("PATCH", `/tasks/${created.id}`, { dueDate: null });
    const { json } = await call("GET", "/tasks?view=any");
    expect(json.tasks.find((x: { id: string }) => x.id === created.id)).toMatchObject({ dueDate: null, dueTime: null });
  });
});

describe("reminder updates", () => {
  it("pausing a reminder keeps its settings", async () => {
    await call("POST", "/reports", {
      name: "Test quarterly return",
      notes: "Attach the bank statement",
      repeat: "quarterly",
      startDate: "2026-10-15",
      dueTime: "11:00",
      endDate: "2028-03-31",
      leadDays: 10,
      priority: "urgent",
    });
    const report = (await call("GET", "/reports")).json.reports.find((r: { name: string }) => r.name === "Test quarterly return");
    expect((await call("PATCH", `/reports/${report.id}`, { active: false })).status).toBe(200);
    const after = (await call("GET", "/reports")).json.reports.find((r: { id: string }) => r.id === report.id);
    expect(after).toMatchObject({ active: false, notes: "Attach the bank statement", repeat: "quarterly", startDate: "2026-10-15", dueTime: "11:00", endDate: "2028-03-31", leadDays: 10, priority: "urgent" });
  });
});

describe("label updates", () => {
  it("renaming a label keeps its colour", async () => {
    const color = { backgroundColor: "#a479e2", textColor: "#ffffff" };
    const { json: created } = await call("POST", "/labels", { name: "Pharmacy", color });
    expect((await call("PATCH", `/labels/${created.id}`, { name: "Pharmacy store" })).status).toBe(200);
    const label = (await call("GET", "/labels")).json.labels.find((l: { id: string }) => l.id === created.id);
    expect(label).toMatchObject({ name: "Pharmacy store", ...color });
  });
});
