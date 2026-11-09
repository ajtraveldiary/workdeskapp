// Offs log (user request 2026-11-10): weekly-off staff's offs, C-offs (the off that pays back the compensatory off: one
// earned while another was owed) and holidays taken (H / SS), oldest first; an off taken before it is earned says so;
// Sunday-off staff and other marks are left out.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { offKinds, type OffsLog } from "../src/shared/offsLog";
import type { WeeklyDay } from "../src/shared/attendance";

const NAME = "2026-27 സാമ്പത്തിക വർഷത്തെ ജൂനിയർ ഹെൽത്ത് ഇൻസ്‌പെക്ടർ ശ്രീമതി അനിതാകുമാരി രാധാകൃഷ്ണൻ";
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

describe("offs log", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const add = async (body: Record<string, unknown>) => (await call("POST", "/staff/employees", body)).json.id as string;
  const mark = (employeeId: string, dates: string[], m: string) => call("POST", "/attendance/mark", { cells: dates.map((date) => ({ employeeId, date })), mark: m });

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    const db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("labels each off: an off earned while another is owed is the C-off; one taken before it is earned is early", () => {
    // 12 days of duty (2 offs owed: the off and the compensatory off), two offs, then an off with none owed.
    const days: WeeklyDay[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ date: day(i + 1), state: "count" as const })),
      { date: day(13), state: "off" },
      { date: day(14), state: "off" },
      { date: day(15), state: "count" },
      { date: day(16), state: "off" },
    ];
    expect([...offKinds(days, { offsDue: 0, towards: 0 })]).toEqual([
      [day(13), "off"],
      [day(14), "coff"],
      [day(16), "early"],
    ]);
    // Starting with two offs owed: the first is an off, the second the C-off; a correction starts afresh.
    expect([...offKinds([{ date: day(1), state: "off" }, { date: day(2), state: "off" }], { offsDue: 2, towards: 0 })].map(([, k]) => k)).toEqual(["off", "coff"]);
    expect([...offKinds([{ date: day(1), state: "count", set: { offsDue: 1, towards: 0, run: 0 } }, { date: day(2), state: "off" }])].map(([, k]) => k)).toEqual(["off"]);
  });

  it("lists weekly-off staff's offs, C-offs and holidays taken in date order", async () => {
    const w = await add({ name: NAME, offDay: "weekly" });
    const s = await add({ name: "Sunday off" });
    // No second Saturdays in October, so the 12 days are plain duty; then back on for SS in November.
    const settings = (await call("GET", "/attendance/settings")).json.settings;
    await call("PUT", "/attendance/settings", { ...settings, secondSaturday: false, start: { [w]: { asOn: "2026-09-30", clTaken: 0, chOpen: [], offsDue: 0, towards: 0 } } });
    await mark(w, Array.from({ length: 12 }, (_, i) => day(i + 1)), "present");
    await mark(w, [day(13), day(14)], "off");
    await mark(w, [day(15)], "present");
    await mark(w, [day(16)], "off");
    await mark(s, [day(13)], "off");
    await mark(w, [day(17)], "cl");
    const oct = (await call("GET", "/attendance/offs-log?from=2026-10-01&to=2026-10-31")).json as OffsLog;
    expect(oct.entries.map((e) => [e.date, e.kind, e.details])).toEqual([
      [day(13), "off", ""],
      [day(14), "coff", ""],
      [day(16), "off", "Taken early (before it was earned)"],
    ]);
    expect(oct.people.map((p) => p.name)).toEqual([NAME]);
    // A holiday of the register and a second Saturday taken.
    await call("PUT", "/attendance/settings", { ...settings, secondSaturday: true, start: { [w]: { asOn: "2026-09-30", clTaken: 0, chOpen: [], offsDue: 0, towards: 0 } } });
    await call("POST", "/attendance/holidays", { date: "2026-11-20", name: "ഗുരു ജയന്തി" });
    await mark(w, ["2026-11-14", "2026-11-20"], "holiday");
    const nov = (await call("GET", "/attendance/offs-log?from=2026-11-01&to=2026-11-30")).json as OffsLog;
    expect(nov.entries.map((e) => [e.date, e.kind, e.details])).toEqual([
      ["2026-11-14", "ss", ""],
      ["2026-11-20", "h", "ഗുരു ജയന്തി"],
    ]);
    expect((await call("GET", "/attendance/offs-log?from=2026-10-31&to=2026-10-01")).status).toBe(400);
  });
});
