// Tags on tasks and reminders (user request 2026-10-11): made once, reused, WorkDesk-only. A reminder's tags go on
// its tasks; deleting a tag takes it off everything; tasks filter and search by tag; the CSV has a Tags column.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Report, Tag, Task } from "../src/shared/types";

let app: ReturnType<typeof createApp>;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
  const text = await res.text();
  return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any, text };
};
const tagList = async () => (await call("GET", "/tags")).json.tags as Tag[];
const tasks = async (q = "") => (await call("GET", `/tasks?view=any${q}`)).json.tasks as Task[];
const reminders = async () => (await call("GET", "/reports")).json.reports as Report[];
const makeTag = async (name: string, color = "teal") => (await call("POST", "/tags", { name, color })).json.id as string;

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  const db = d as unknown as DB;
  app = createApp({ getDb: () => db, allowDemo: true });
});

describe("tags", () => {
  it("are made once and reused, whatever the capitals", async () => {
    const nhm = await makeTag("NHM");
    expect(await makeTag("  nhm ")).toBe(nhm);
    await makeTag("Salary", "orange");
    expect((await tagList()).map((t) => [t.name, t.color])).toEqual([
      ["NHM", "teal"],
      ["Salary", "orange"],
    ]);
    // Renaming onto another tag's name is refused.
    expect((await call("PATCH", `/tags/${nhm}`, { name: "SALARY" })).status).toBe(409);
    expect((await call("POST", "/tags", { name: "x", color: "neon" })).status).toBe(400);
  });

  it("go on tasks, which filter and search by them, and count their use", async () => {
    const salary = await makeTag("Salary");
    const nhm = await makeTag("NHM");
    const a = (await call("POST", "/tasks", { title: "Prepare salary bill", tagIds: [salary, nhm] })).json.id as string;
    await call("POST", "/tasks", { title: "Stock check" });
    expect((await tasks()).find((t) => t.id === a)!.tagIds).toEqual([salary, nhm]);
    expect((await tasks(`&tag=${nhm}`)).map((t) => t.title)).toEqual(["Prepare salary bill"]);
    // Search finds a task by its tag's name.
    const zq = await makeTag("Zqx section");
    await call("PATCH", `/tasks/${a}`, { tagIds: [salary, nhm, zq] });
    expect((await tasks("&q=zqx")).map((t) => t.title)).toEqual(["Prepare salary bill"]);
    await call("PATCH", `/tasks/${a}`, { tagIds: [salary, nhm] });
    // Changing other fields keeps the tags; sending tagIds replaces them.
    await call("PATCH", `/tasks/${a}`, { priority: "high" });
    expect((await tasks()).find((t) => t.id === a)!.tagIds).toEqual([salary, nhm]);
    await call("PATCH", `/tasks/${a}`, { tagIds: [nhm] });
    expect((await tasks()).find((t) => t.id === a)!.tagIds).toEqual([nhm]);
    expect((await tagList()).find((t) => t.id === nhm)!.tasks).toBe(1);
  });

  it("refuse ids that aren't the user's tags", async () => {
    expect((await call("POST", "/tasks", { title: "x", tagIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(400);
  });

  it("on a reminder go on its tasks, and changes reach its open tasks", async () => {
    const hmis = await makeTag("HMIS");
    const monthly = await makeTag("Monthly");
    const today = (await call("GET", "/me")).json.today as string;
    const { id } = (await call("POST", "/reports", { name: "Tag test return", startDate: today, repeat: "monthly", tagIds: [hmis] })).json;
    expect((await reminders()).find((r) => r.id === id)!.tagIds).toEqual([hmis]);
    const mine = async () => (await tasks()).filter((t) => t.title === "Tag test return");
    expect((await mine()).length).toBeGreaterThan(0);
    expect((await mine()).every((t) => t.tagIds.join() === hmis)).toBe(true);
    await call("PATCH", `/reports/${id}`, { tagIds: [hmis, monthly] });
    expect((await mine()).every((t) => t.tagIds.join() === [hmis, monthly].join())).toBe(true);
  });

  it("deleted are taken off tasks and reminders, which stay", async () => {
    const old = await makeTag("Old");
    const keep = await makeTag("Keep");
    const today = (await call("GET", "/me")).json.today as string;
    await call("POST", "/tasks", { title: "Tagged task", tagIds: [old, keep] });
    await call("POST", "/reports", { name: "Tagged reminder", startDate: today, tagIds: [old] });
    await call("DELETE", `/tags/${old}`);
    expect((await tasks()).find((t) => t.title === "Tagged task")!.tagIds).toEqual([keep]);
    expect((await reminders()).find((r) => r.name === "Tagged reminder")!.tagIds).toEqual([]);
    expect((await tagList()).map((t) => t.name)).toEqual(["Keep"]);
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((e) => e.summary);
    expect(history).toContain("Tag deleted: Old (tasks, reminders and files kept)");
  });

  it("are shared with the File register: counted, cleaned up on delete, and in its CSV", async () => {
    const audit = await makeTag("Audit");
    const keep = await makeTag("Keep");
    const { json: f } = await call("POST", "/files", { subject: "Professional Tax", efileNumber: "255/2026", tagIds: [audit, keep] });
    const files = async () => (await call("GET", "/files")).json.files as { id: string; subject: string; tagIds: string[] }[];
    expect((await files()).find((x) => x.id === f.id)!.tagIds).toEqual([audit, keep]);
    expect((await tagList()).find((t) => t.id === audit)!.files).toBe(1);
    expect((await call("POST", "/files", { subject: "x", tagIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(400);
    // CSV: export has the names; import makes new ones and replaces the file's tags.
    expect((await call("GET", "/transfer/files/csv")).text).toContain("Audit, Keep");
    const res = (await call("POST", "/transfer/files/import", { headers: ["Subject", "E-file number", "Tags"], rows: [["Professional Tax", "255/2026", "Keep; Returns"]] })).json;
    expect(res).toMatchObject({ updated: 1, problems: [] });
    const names = new Map((await tagList()).map((t) => [t.id, t.name]));
    expect((await files())[0]!.tagIds.map((id) => names.get(id))).toEqual(["Keep", "Returns"]);
    await call("DELETE", `/tags/${keep}`);
    expect((await files())[0]!.tagIds.map((id) => names.get(id))).toEqual(["Returns"]);
  });

  it("round-trip through the Tasks CSV, new names becoming tags", async () => {
    const bills = await makeTag("Bills");
    await call("POST", "/tasks", { title: "Pay water bill", tagIds: [bills] });
    const csv = (await call("GET", "/transfer/tasks/csv")).text;
    expect(csv.split("\n")[0]).toContain("Tags");
    expect(csv).toContain("Bills");
    const res = (await call("POST", "/transfer/tasks/import", { headers: ["Title", "Tags"], rows: [["Collect audit report", "Audit, bills"], ["Pay water bill", "Bills; Urgent work"]] })).json;
    expect(res).toMatchObject({ added: 1, updated: 1, problems: [] });
    const all = await tasks();
    const names = new Map((await tagList()).map((t) => [t.id, t.name]));
    expect(all.find((t) => t.title === "Collect audit report")!.tagIds.map((id) => names.get(id))).toEqual(["Audit", "Bills"]);
    expect(all.find((t) => t.title === "Pay water bill")!.tagIds.map((id) => names.get(id))).toEqual(["Bills", "Urgent work"]);
  });
});
