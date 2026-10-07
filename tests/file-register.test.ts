// File register (user request 2026-10-07): old physical files and e-files, one entry per e-file number.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { OfficeFile } from "../src/shared/types";

const MAL = "ജെ.പി.എച്ച്.എൻ. എസ്റ്റാബ്ലിഷ്മെന്റ് ഫയൽ - ജില്ലാ മെഡിക്കൽ ഓഫീസ് (ആരോഗ്യം), തിരുവനന്തപുരം - 2019 മുതൽ";

describe("file register", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const list = async () => (await call("GET", "/files")).json.files as OfficeFile[];
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("keeps physical files and e-files, refuses a second entry with the same e-file number", async () => {
    await call("POST", "/files", { subject: "Professional Tax", physical: true, efileNumber: "255/2026" });
    await call("POST", "/files", { subject: "Salary Certificate file", physical: false, efileNumber: "340/2026" });
    const jphn = (await call("POST", "/files", { subject: MAL, physical: true })).json.id as string;
    const all = await list();
    expect(all.map((f) => [f.subject, f.physical, f.efileNumber])).toEqual([
      ["Professional Tax", true, "255/2026"],
      ["Salary Certificate file", false, "340/2026"],
      [MAL, true, ""],
    ]);
    const dup = await call("POST", "/files", { subject: "Again", efileNumber: "255/2026" });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toContain("Professional Tax");

    // The e-file is created later: noted in History.
    await call("PUT", `/files/${jphn}`, { subject: MAL, physical: true, efileNumber: "412/2026" });
    expect((await list()).find((f) => f.id === jphn)!.efileNumber).toBe("412/2026");
    const history = JSON.stringify((await call("GET", "/history")).json);
    expect(history).toContain("E-file 412/2026 noted");
    expect(history).toContain("File added to the register: Professional Tax (e-file 255/2026)");

    expect((await call("DELETE", `/files/${jphn}`)).status).toBe(200);
    expect((await list()).length).toBe(2);
    expect((await call("POST", "/files", { subject: "" })).status).toBe(400);
  });
});
