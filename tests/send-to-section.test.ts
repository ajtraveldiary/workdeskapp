// Remove → Send to a section (user request 2026-10-07): the section's label goes on the emails and they move to
// Other sections; undo takes it off and brings them back. Only section labels are accepted.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { Thread } from "../src/shared/types";

describe("send to a section", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const threads = async (state: string) => (await call("GET", `/threads?state=${state}`)).json.threads as Thread[];
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("labels the emails, moves them to Other sections, and undo brings them back", async () => {
    const section = (await call("POST", "/labels", { name: "ജില്ലാ മെഡിക്കൽ ഓഫീസ് അക്കൗണ്ട്സ് സെക്ഷൻ", color: null })).json.id as string;
    const [a, b] = await threads("needs_decision");
    const ids = [a!.id, b!.id];

    expect((await call("POST", "/threads/bulk-section", { ids, labelId: section })).json).toEqual({ moved: 2 });
    const away = (await threads("elsewhere")).filter((t) => ids.includes(t.id));
    expect(away).toHaveLength(2);
    for (const t of away) {
      expect(t.sectionLabelId).toBe(section);
      expect(t.labelIds).toContain(section);
    }
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("Sent to the ജില്ലാ മെഡിക്കൽ ഓഫീസ് അക്കൗണ്ട്സ് സെക്ഷൻ section");

    expect((await call("POST", "/threads/bulk-section", { ids, labelId: section, undo: true })).json).toEqual({ moved: 2 });
    const back = (await threads("needs_decision")).filter((t) => ids.includes(t.id));
    expect(back).toHaveLength(2);
    for (const t of back) {
      expect(t.labelIds).not.toContain(section);
      expect(t.sectionLabelId).toBeNull();
    }
  });

  it("undo puts an email back exactly where it was, also one that came back from another section", async () => {
    const urgent = (await call("POST", "/labels", { name: "Urgent section", color: null })).json.id as string;
    const accounts = (await call("POST", "/labels", { name: "Accounts", color: null })).json.id as string;
    const [t] = await threads("needs_decision");
    // It is with Urgent, then a reply brings it back to Pending ("Back from Urgent").
    await call("PUT", `/threads/${t!.id}/labels`, { add: [urgent], remove: [] });
    expect((await threads("elsewhere")).some((x) => x.id === t!.id)).toBe(true);
    await call("POST", "/threads/bulk-restore", { ids: [t!.id] });
    const before = (await threads("needs_decision")).find((x) => x.id === t!.id)!;
    expect(before.sectionLabelId).toBe(urgent);

    await call("POST", "/threads/bulk-section", { ids: [t!.id], labelId: accounts });
    await call("POST", "/threads/bulk-section", { ids: [t!.id], labelId: accounts, undo: true, previous: [{ id: t!.id, state: "needs_decision", sectionLabelId: urgent }] });
    const after = (await threads("needs_decision")).find((x) => x.id === t!.id)!;
    expect(after.sectionLabelId).toBe(urgent);
    expect(after.labelIds).toContain(urgent);
    expect(after.labelIds).not.toContain(accounts);
  });

  it("refuses system labels, the task / done labels and organising labels", async () => {
    const own = (await call("POST", "/labels", { name: "My work", color: null })).json.id as string;
    const organise = (await call("POST", "/labels", { name: "Circulars", color: null })).json.id as string;
    await call("PUT", "/labels/task-settings", { taskLabelId: own, doneLabelId: null, autoDoneLabelIds: [], organizeLabelIds: [organise] });
    const [t] = await threads("needs_decision");
    for (const labelId of ["INBOX", "TRASH", own, organise]) {
      expect((await call("POST", "/threads/bulk-section", { ids: [t!.id], labelId })).status).toBe(400);
    }
    expect((await threads("needs_decision")).some((x) => x.id === t!.id)).toBe(true);
  });
});
