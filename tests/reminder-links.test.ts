// Links kept with a reminder (user request 2026-10-07): saved, returned with the reminder and its tasks.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Report, Task } from "../src/shared/types";

describe("reminder links", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("saves links with a reminder and shows them on its task", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const links = [
      { url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit", name: "2026-27 സാമ്പത്തിക വർഷത്തെ ചെലവ് സ്റ്റേറ്റ്മെന്റ് ഷീറ്റ്" },
      { url: "https://drive.google.com/drive/folders/1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765", name: "" },
    ];
    const created = await call("POST", "/reports", { name: "പ്രതിമാസ ചെലവ് സ്റ്റേറ്റ്മെന്റ് സമർപ്പിക്കൽ", startDate: today, repeat: "monthly", links });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    const report = ((await call("GET", "/reports")).json.reports as Report[]).find((r) => r.id === id)!;
    expect(report.links).toEqual(links);
    const task = ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.report?.reportId === id)!;
    expect(task.report!.links).toEqual(links);

    // Editing something else keeps them; links can be removed; only web links are taken.
    await call("PATCH", `/reports/${id}`, { priority: "high" });
    expect(((await call("GET", "/reports")).json.reports as Report[]).find((r) => r.id === id)!.links).toHaveLength(2);
    await call("PATCH", `/reports/${id}`, { links: [links[0]] });
    expect(((await call("GET", "/reports")).json.reports as Report[]).find((r) => r.id === id)!.links).toEqual([links[0]]);
    expect((await call("PATCH", `/reports/${id}`, { links: [{ url: "javascript:alert(1)", name: "" }] })).status).toBe(400);
  });
});
