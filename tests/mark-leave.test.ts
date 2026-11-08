// Mark leave pop-up (user request 2026-11-08, docs/ATTENDANCE_MARK_LEAVE_PLAN.md phase 1): one person's days to a
// later day (`?from=&until=`), working days counted from a date (holidays, second Saturdays and Sunday-off staff's
// Sundays skipped; weekly-off staff work Sundays), and the rule warnings shared with Person days (every one listed,
// CH past the post's limit).
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import type { PersonDay, PersonDays } from "../src/shared/types";
import { markWarnings, workingDays } from "../src/shared/markWarnings";

const NAME = "2026-27 സാമ്പത്തിക വർഷത്തെ ജൂനിയർ ഹെൽത്ത് ഇൻസ്‌പെക്ടർ ശ്രീമതി അനിതാകുമാരി രാധാകൃഷ്ണൻ";
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

describe("Mark leave", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const add = async (body: Record<string, unknown>) => (await call("POST", "/staff/employees", body)).json.id as string;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    const db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("gives a person's days on to `until` (at most 70 days from the Monday) and counts working days", async () => {
    const s = await add({ name: NAME });
    const w = await add({ name: "Weekly", offDay: "weekly" });
    // Fri 13 Nov 2026; Sat 14 is the second Saturday; a holiday on Wed 18.
    await call("POST", "/attendance/holidays", { date: "2026-11-18", name: "Test holiday" });
    const days = async (id: string, q: string) => (await call("GET", `/attendance/person/${id}?${q}`)).json as PersonDays;
    const p = await days(s, "from=2026-11-13&until=2026-12-31");
    expect([p.from, p.to]).toEqual(["2026-11-09", "2026-12-31"]);
    expect((await days(s, "from=2026-11-13&until=2027-06-01")).to).toBe(shift("2026-11-09", 69));
    // An `until` inside the usual three weeks keeps the three weeks.
    expect((await days(s, "from=2026-11-13&until=2026-11-14")).days.length).toBe(21);

    // Sunday-off staff: 4 days of CL from Friday skip the second Saturday, Sunday and the holiday.
    expect(workingDays(p, "2026-11-13", 4, null)).toEqual({
      dates: ["2026-11-13", "2026-11-16", "2026-11-17", "2026-11-19"],
      skipped: [
        { date: "2026-11-14", why: "Second Saturday" },
        { date: "2026-11-15", why: "Sunday" },
        { date: "2026-11-18", why: "Test holiday" },
      ],
    });
    // To a last day instead: every working day from–to.
    expect(workingDays(p, "2026-11-13", null, "2026-11-16").dates).toEqual(["2026-11-13", "2026-11-16"]);
    // Weekly-off staff work Sundays.
    const q = await days(w, "from=2026-11-13&until=2026-12-31");
    expect(workingDays(q, "2026-11-13", 3, null).dates).toEqual(["2026-11-13", "2026-11-15", "2026-11-16"]);
    // Leave from the Leave page is skipped and named.
    const leave = { ...p, days: p.days.map((d) => (d.date === "2026-11-16" ? { ...d, leave: "EL" } : d)) };
    expect(workingDays(leave, "2026-11-13", 2, null)).toMatchObject({ dates: ["2026-11-13", "2026-11-17"], skipped: [{ date: "2026-11-14" }, { date: "2026-11-15" }, { date: "2026-11-16", why: "on EL" }] });
  });

  // A made-up person for the warnings: days from Mon 2 Nov 2026.
  const person = (over: Partial<PersonDays>, marks: Record<string, PersonDay["mark"]> = {}, extra: Record<string, Partial<PersonDay>> = {}): PersonDays => ({
    today: "2026-11-02",
    from: "2026-11-02",
    to: "2026-11-22",
    settings: { offEvery: 6, maxRun: 12, clPerYear: 20, assumeDuty: false },
    employee: { id: "e", name: NAME, designation: null, offDay: "sunday", permanent: true },
    days: Array.from({ length: 21 }, (_, i) => {
      const date = shift("2026-11-02", i);
      const weekday = (i + 1) % 7;
      return { date, weekday, holiday: over.employee?.offDay !== "weekly" && weekday === 0 ? "Sunday" : null, mark: marks[date] ?? null, note: "", chHoliday: null, leave: null, out: false, planned: false, ...extra[date] };
    }),
    weekly: null,
    lastOff: null,
    cl: 0,
    ch: 0,
    chLimit: 22,
    chOpen: [],
    edges: { before: 0, after: 0 },
    ...over,
  });

  it("lists every warning that applies, with its rule", () => {
    // CL past the year and next to leave: both listed (one used to replace the other).
    const p = person({ cl: 19 }, {}, { "2026-11-06": { leave: "EL" } });
    const cl = markWarnings(p, new Set(["2026-11-04", "2026-11-05"])).cl!;
    expect(cl.map((w) => w.short)).toEqual(["21 of 20 CL", "next to leave"]);
    expect(cl[0]!.rule).toContain("KSR");
    // CH past the post's limit, and no holiday worked open.
    const ch = markWarnings(person({ ch: 22 }), new Set(["2026-11-04"])).ch!;
    expect(ch.map((w) => w.short)).toEqual(["23 of 22 CH", "no holiday worked open"]);
    expect(markWarnings(person({ ch: 3, chLimit: null }), new Set(["2026-11-04"])).ch!.map((w) => w.short)).toEqual(["no holiday worked open"]);
    // Holidays chosen alone warn of nothing.
    expect(markWarnings(person({ cl: 25 }), new Set(["2026-11-08"]))).toEqual({});
    // An off before it is earned: 3 days of duty, then an off, 3 more days needed.
    const weekly = person(
      { employee: { id: "e", name: NAME, designation: null, offDay: "weekly", permanent: true }, weekly: { countFrom: "2026-11-02", offsDue: 0, towards: 0, run: 0, dueBefore: 0, towardsBefore: 0, runBefore: 0, owedSince: [] } },
      { "2026-11-02": "present", "2026-11-03": "present", "2026-11-04": "present" },
    );
    const off = markWarnings(weekly, new Set(["2026-11-05"])).off!;
    expect(off[0]).toMatchObject({ short: "3 days early" });
    expect(off[0]!.text).toContain("3 more days");
  });
});
