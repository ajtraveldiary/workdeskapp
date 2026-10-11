// Saved website logins (user request 2026-10-11): SPARK-style personal logins and BiMS-style shared ones.
// Passwords are encrypted in the database, never in lists, and every reveal is noted in History.
// All values here are made-up test data.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { SiteLogin } from "../src/shared/types";

// A throwaway 32-byte test key (base64), as TOKEN_ENC_KEY would be in production.
const env = { TOKEN_ENC_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1))) };
const TEST_PASSWORD = "test-pass-1";

let app: ReturnType<typeof createApp>;
let db: DB;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, env);
  return { status: res.status, json: (await res.json().catch(() => null)) as any, headers: res.headers };
};
const list = async (q = "") => (await call("GET", `/logins${q}`)).json.logins as SiteLogin[];
const history = async () => ((await call("GET", "/history")).json.events as { summary: string }[]).map((e) => e.summary);

beforeEach(async () => {
  const d = drizzle({ client: new PGlite(), schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as DB;
  app = createApp({ getDb: () => db, allowDemo: true });
});

describe("saved logins", () => {
  it("one website keeps many logins: per employee (SPARK) and per role (BiMS)", async () => {
    const anu = (await call("POST", "/staff/employees", { name: "Anu Test" })).json.id as string;
    expect((await call("POST", "/logins", { website: "SPARK", url: "spark.example.test", employeeId: anu, loginId: "anu.spark", password: TEST_PASSWORD })).status).toBe(201);
    await call("POST", "/logins", { website: "BiMS", url: "https://bims.example.test", assignedTo: "DDO", loginId: "ddo.bims", password: TEST_PASSWORD });
    await call("POST", "/logins", { website: "BiMS", url: "https://bims.example.test", assignedTo: "Section clerk", loginId: "clerk.bims", remarks: "Shared" });

    const all = await list();
    expect(all.map((l) => [l.website, l.assignedTo, l.loginId, l.hasPassword])).toEqual([
      ["BiMS", "DDO", "ddo.bims", true],
      ["BiMS", "Section clerk", "clerk.bims", false],
      ["SPARK", "Anu Test", "anu.spark", true],
    ]);
    // A link without https:// gets it added.
    expect(all.find((l) => l.website === "SPARK")!.url).toBe("https://spark.example.test");
    // The employee's page lists only theirs.
    expect((await list(`?employee=${anu}`)).map((l) => l.loginId)).toEqual(["anu.spark"]);
  });

  it("never puts the password in lists, and stores it encrypted", async () => {
    await call("POST", "/logins", { website: "SPARK", assignedTo: "DDO", loginId: "x", password: TEST_PASSWORD });
    const raw = JSON.stringify(await list());
    expect(raw).not.toContain(TEST_PASSWORD);
    expect(raw).not.toContain("password");
    const [row] = await db.select().from(schema.siteLogins);
    expect(row!.passwordEnc).toBeTruthy();
    expect(row!.passwordEnc).not.toContain(TEST_PASSWORD);
    expect(row!.passwordEnc!.startsWith("plain:")).toBe(false);
  });

  it("reveals the password only on request, uncached, and notes each one in History", async () => {
    const { id } = (await call("POST", "/logins", { website: "BiMS", assignedTo: "DDO", loginId: "ddo.bims", password: TEST_PASSWORD })).json;
    const shown = await call("POST", `/logins/${id}/reveal`, {});
    expect(shown.json.password).toBe(TEST_PASSWORD);
    expect(shown.headers.get("cache-control")).toBe("no-store");
    await call("POST", `/logins/${id}/reveal`, { copy: true });
    const h = await history();
    expect(h).toContain("Password shown: BiMS · ddo.bims");
    expect(h).toContain("Password copied: BiMS · ddo.bims");
  });

  it("editing keeps the password unless a new one is typed or it is removed", async () => {
    const { id } = (await call("POST", "/logins", { website: "SPARK", assignedTo: "DDO", loginId: "a", password: TEST_PASSWORD })).json;
    const reveal = async () => (await call("POST", `/logins/${id}/reveal`, {})).json?.password;
    await call("PUT", `/logins/${id}`, { website: "SPARK", assignedTo: "DDO", loginId: "a2", remarks: "Renamed" });
    expect(await reveal()).toBe(TEST_PASSWORD);
    await call("PUT", `/logins/${id}`, { website: "SPARK", assignedTo: "DDO", loginId: "a2", password: "test-pass-2" });
    expect(await reveal()).toBe("test-pass-2");
    await call("PUT", `/logins/${id}`, { website: "SPARK", assignedTo: "DDO", loginId: "a2", password: "" });
    expect((await list())[0]!.hasPassword).toBe(false);
    expect((await call("POST", `/logins/${id}/reveal`, {})).status).toBe(404);
  });

  it("an employee's login keeps their name if the employee is deleted", async () => {
    const id = (await call("POST", "/staff/employees", { name: "Leaving Test" })).json.id as string;
    await call("POST", "/logins", { website: "SPARK", employeeId: id, loginId: "leaving" });
    await call("DELETE", `/staff/employees/${id}`);
    const [l] = await list();
    expect(l!.employeeId).toBeNull();
    expect(l!.assignedTo).toBe("Leaving Test");
  });

  it("refuses a missing website name and removes logins", async () => {
    expect((await call("POST", "/logins", { website: " " })).status).toBe(400);
    const { id } = (await call("POST", "/logins", { website: "BiMS", assignedTo: "DDO" })).json;
    await call("DELETE", `/logins/${id}`);
    expect(await list()).toEqual([]);
    expect(await history()).toContain("Login removed: BiMS · DDO");
  });
});
