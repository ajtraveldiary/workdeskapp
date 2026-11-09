// Day off and gazetted by designation (user request 2026-11-10, "make it designation wise, but allow an exception per
// employee; otherwise default to the designation"): employees follow their post's day off and gazetted tick unless
// set individually; changing the post moves its followers only; the CSV and the employee form's choices.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { postValue } from "../src/server/routes/staff";
import type { StaffList } from "../src/shared/types";

const NAME = "2026-27 സാമ്പത്തിക വർഷത്തെ ജൂനിയർ ഹെൽത്ത് ഇൻസ്‌പെക്ടർ ശ്രീമതി അനിതാകുമാരി രാധാകൃഷ്ണൻ";

describe("posts: day off and gazetted by designation", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const staff = async () => (await call("GET", "/staff")).json as StaffList;
  const person = async (id: string) => (await staff()).employees.find((e) => e.id === id)!;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("decides between the post and the employee's own", () => {
    // Follow the post.
    expect(postValue(false, "sunday", true, "sunday", "weekly")).toEqual({ own: false, value: "weekly" });
    // Set individually.
    expect(postValue(true, "sunday", false, "weekly", "weekly")).toEqual({ own: true, value: "sunday" });
    // Not said (older forms, assistants): a value different from the post's is an exception; the same keeps the
    // saved choice; none keeps the saved one.
    expect(postValue(undefined, "sunday", false, "weekly", "weekly")).toEqual({ own: true, value: "sunday" });
    expect(postValue(undefined, "weekly", false, "weekly", "weekly")).toEqual({ own: false, value: "weekly" });
    expect(postValue<string>(undefined, undefined, true, "sunday", "weekly")).toEqual({ own: true, value: "sunday" });
    expect(postValue<string>(undefined, undefined, false, "sunday", "weekly")).toEqual({ own: false, value: "weekly" });
  });

  it("employees follow their post, exceptions stay, and changing the post moves only its followers", async () => {
    const nurse = (await call("POST", "/staff/designations", { name: "Staff Nurse" })).json.id as string;
    const clerk = (await call("POST", "/staff/designations", { name: "Senior Clerk" })).json.id as string;
    expect((await call("POST", `/staff/designations/${nurse}/off-day`, { offDay: "weekly" })).json).toEqual({ ok: true, changed: 0 });
    // A new nurse follows the post; one set individually to Sunday off stays.
    const a = (await call("POST", "/staff/employees", { name: NAME, designationId: nurse })).json.id as string;
    const b = (await call("POST", "/staff/employees", { name: "Biju", designationId: nurse, offDay: "sunday", offDayOwn: true })).json.id as string;
    expect([(await person(a)).offDay, (await person(a)).offDayOwn]).toEqual(["weekly", false]);
    expect([(await person(b)).offDay, (await person(b)).offDayOwn]).toEqual(["sunday", true]);
    // The post back to Sunday off and to weekly again: the follower moves, the exception doesn't.
    await call("POST", `/staff/designations/${nurse}/off-day`, { offDay: "sunday" });
    expect((await person(a)).offDay).toBe("sunday");
    const back = await call("POST", `/staff/designations/${nurse}/off-day`, { offDay: "weekly" });
    expect(back.json.changed).toBe(1);
    expect([(await person(a)).offDay, (await person(b)).offDay]).toEqual(["weekly", "sunday"]);
    expect((await staff()).designations.find((d) => d.id === nurse)!.offDay).toBe("weekly");
    // A follower moved to another post takes its day off; set back to "as post", the exception follows again.
    const e = await person(a);
    await call("PUT", `/staff/employees/${a}`, { ...e, designationId: clerk });
    expect([(await person(a)).offDay, (await person(a)).offDayOwn]).toEqual(["sunday", false]);
    const f = await person(b);
    await call("PUT", `/staff/employees/${b}`, { ...f, offDayOwn: false });
    expect([(await person(b)).offDay, (await person(b)).offDayOwn]).toEqual(["weekly", false]);
    // An older form sending a different day off without saying: kept as an exception.
    const g = await person(b);
    const { offDayOwn: _o, ...older } = g;
    await call("PUT", `/staff/employees/${b}`, { ...older, offDay: "sunday" });
    expect([(await person(b)).offDay, (await person(b)).offDayOwn]).toEqual(["sunday", true]);
    // History names the post.
    const history = ((await call("GET", "/history")).json.events as { summary: string }[]).map((x) => x.summary);
    expect(history).toContain("Staff Nurse: Weekly off (1 employee changed)");
    expect((await call("POST", `/staff/designations/${nurse}/off-day`, { offDay: "monthly" })).status).toBe(400);
  });

  it("gazetted follows the post for permanent staff, keeping exceptions", async () => {
    const mo = (await call("POST", "/staff/designations", { name: "Medical Officer" })).json.id as string;
    const a = (await call("POST", "/staff/employees", { name: NAME, designationId: mo })).json.id as string;
    const b = (await call("POST", "/staff/employees", { name: "Biju", designationId: mo, gazetted: true, gazettedOwn: true })).json.id as string;
    const t = (await call("POST", "/staff/employees", { name: "Daily wage", designationId: mo, permanent: false })).json.id as string;
    expect([(await person(a)).gazetted, (await person(b)).gazetted, (await person(b)).gazettedOwn]).toEqual([false, true, true]);
    await call("POST", `/staff/designations/${mo}/gazetted`, { gazetted: true });
    expect([(await person(a)).gazetted, (await person(t)).gazetted]).toEqual([true, false]);
    // Not gazetted any more: the follower changes, the exception (set to yes) stays.
    await call("POST", `/staff/designations/${mo}/gazetted`, { gazetted: false });
    expect([(await person(a)).gazetted, (await person(b)).gazetted]).toEqual([false, true]);
  });

  it("the employees CSV: a day off different from the post is an exception, none follows the post", async () => {
    const nurse = (await call("POST", "/staff/designations", { name: "Staff Nurse" })).json.id as string;
    await call("POST", `/staff/designations/${nurse}/off-day`, { offDay: "weekly" });
    const r = await call("POST", "/transfer/employees/import", {
      headers: ["Name", "Designation", "Day off"],
      rows: [
        [NAME, "Staff Nurse", ""],
        ["Biju", "Staff Nurse", "Sunday off"],
        ["Mary", "Staff Nurse", "Weekly off"],
      ],
      firstLine: 2,
    });
    expect(r.json.added).toBe(3);
    const s = await staff();
    const of = (n: string) => s.employees.find((e) => e.name === n)!;
    expect([of(NAME).offDay, of(NAME).offDayOwn]).toEqual(["weekly", false]);
    expect([of("Biju").offDay, of("Biju").offDayOwn]).toEqual(["sunday", true]);
    expect([of("Mary").offDay, of("Mary").offDayOwn]).toEqual(["weekly", false]);
  });

  it("the migration keeps everyone as they were: each post takes what most have, the rest are exceptions", async () => {
    const nurse = (await call("POST", "/staff/designations", { name: "Staff Nurse" })).json.id as string;
    const clerk = (await call("POST", "/staff/designations", { name: "Senior Clerk" })).json.id as string;
    await call("POST", `/staff/designations/${clerk}/gazetted`, { gazetted: true });
    // As before the change: own settings on everyone, no flags, posts on their defaults.
    const add = async (name: string, designationId: string | null, offDay: string, gazetted = false) =>
      (await call("POST", "/staff/employees", { name, designationId, offDay, offDayOwn: true, gazetted, gazettedOwn: true })).json.id as string;
    const n1 = await add("N1", nurse, "weekly");
    const n2 = await add("N2", nurse, "weekly");
    const n3 = await add("N3", nurse, "sunday");
    const c1 = await add("C1", clerk, "sunday", true);
    const c2 = await add("C2", clerk, "sunday", false);
    const none = await add("No post", null, "weekly");
    await db.execute(sql`update employees set off_day_own = false, gazetted_own = false`);
    await db.execute(sql`update designations set off_day = 'sunday'`);
    // The data step of migration 0058.
    const steps = readFileSync("drizzle/0058_post_day_off.sql", "utf8").split("--> statement-breakpoint").filter((x) => /\bUPDATE\b/.test(x.replace(/--[^\n]*/g, "")));
    expect(steps.length).toBe(3);
    for (const st of steps) await db.execute(sql.raw(st));
    const s = await staff();
    const of = (id: string) => s.employees.find((e) => e.id === id)!;
    expect(s.designations.find((d) => d.id === nurse)!.offDay).toBe("weekly");
    expect(s.designations.find((d) => d.id === clerk)!.offDay).toBe("sunday");
    expect([n1, n2, n3, c1, none].map((id) => [of(id).offDay, of(id).offDayOwn])).toEqual([
      ["weekly", false],
      ["weekly", false],
      ["sunday", true],
      ["sunday", false],
      ["weekly", true],
    ]);
    // Clerk is a gazetted post: C1 (gazetted) follows it, C2 (not) is an exception.
    expect([of(c1).gazettedOwn, of(c2).gazettedOwn]).toEqual([false, true]);
  });
});
