// Which employee the user is (Settings > Employees, user request 2026-10-12): set, checked, cleared, in History,
// and forgotten when that employee is deleted.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";

describe("you are an employee", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
  };
  const me = async () => (await call("GET", "/me")).json.employeeId as string | null;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("is chosen in Settings, checked, cleared, and noted in History", async () => {
    expect(await me()).toBeNull();
    const id = (await call("POST", "/staff/employees", { name: "അനിത കുമാരി" })).json.id as string;
    expect((await call("PUT", "/me/employee", { employeeId: id })).status).toBe(200);
    expect(await me()).toBe(id);
    expect((await call("PUT", "/me/employee", { employeeId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    expect(await me()).toBe(id);
    await call("PUT", "/me/employee", { employeeId: null });
    expect(await me()).toBeNull();
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((h) => h.summary);
    expect(history).toContain("You are set as അനിത കുമാരി");
    expect(history).toContain("You are no longer set as an employee");
  });

  it("is forgotten when that employee is deleted", async () => {
    const id = (await call("POST", "/staff/employees", { name: "Short Stay" })).json.id as string;
    await call("PUT", "/me/employee", { employeeId: id });
    expect((await call("DELETE", `/staff/employees/${id}`)).status).toBe(200);
    expect(await me()).toBeNull();
  });
});
