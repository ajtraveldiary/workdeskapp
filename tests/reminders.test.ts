// Reminders replaced recurring reports (user request 2026-10-06): a date, an optional time and a standard
// Repeat choice. Each occurrence gets its own task ahead of its date; old reports were converted in place.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { ensureReportPeriods } from "../src/server/lib/reports";
import { nextOccurrence, occurrences, repeatText, type ReminderRule } from "../src/shared/reminderSchedule";

const rule = (r: Partial<ReminderRule> & Pick<ReminderRule, "repeat" | "startDate">): ReminderRule => ({
  dueDay: Number(r.startDate.slice(8, 10)),
  endDate: null,
  ...r,
});

describe("reminder schedule", () => {
  it("monthly on the 31st stays on the last day of each month", () => {
    expect(occurrences(rule({ repeat: "monthly", startDate: "2026-01-31" }), () => true, 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("weekly, every 2 weeks and daily step by days", () => {
    expect(occurrences(rule({ repeat: "weekly", startDate: "2026-10-05" }), () => true, 3)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(occurrences(rule({ repeat: "biweekly", startDate: "2026-12-28" }), () => true, 2)).toEqual(["2026-12-28", "2027-01-11"]);
    expect(occurrences(rule({ repeat: "daily", startDate: "2026-02-28" }), () => true, 2)).toEqual(["2026-02-28", "2026-03-01"]);
  });

  it("every 3 months, every year, never and an end date", () => {
    expect(occurrences(rule({ repeat: "quarterly", startDate: "2026-07-15" }), () => true, 3)).toEqual(["2026-07-15", "2026-10-15", "2027-01-15"]);
    expect(occurrences(rule({ repeat: "yearly", startDate: "2028-02-29" }), () => true, 2)).toEqual(["2028-02-29", "2029-02-28"]);
    expect(occurrences(rule({ repeat: "never", startDate: "2026-10-09" }), () => true)).toEqual(["2026-10-09"]);
    expect(occurrences(rule({ repeat: "monthly", startDate: "2026-10-05", endDate: "2026-12-04" }), () => true)).toEqual(["2026-10-05", "2026-11-05"]);
  });

  it("next date and wording", () => {
    const meeting = rule({ repeat: "weekly", startDate: "2026-09-21" });
    expect(nextOccurrence(meeting, "2026-10-06")).toBe("2026-10-12");
    expect(nextOccurrence(rule({ repeat: "never", startDate: "2026-10-01" }), "2026-10-06")).toBeNull();
    expect(repeatText(meeting)).toBe("Every week on Monday");
    expect(repeatText(rule({ repeat: "monthly", startDate: "2026-10-05" }))).toBe("Every month on the 5th");
    expect(repeatText(rule({ repeat: "monthly", startDate: "2026-10-31" }))).toBe("Every month on the last day");
    expect(repeatText(rule({ repeat: "never", startDate: "2026-10-09" }))).toBe("Once, on 9 Oct 2026");
  });
});

// --- Through the API, with the demo user ---

let app: ReturnType<typeof createApp>;
let db: DB;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
  const text = await res.text();
  return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
};
type T = { id: string; title: string; dueDate: string | null; dueTime: string | null; labelIds: string[]; status: string; report: { periodId: string } | null };
const tasksNamed = async (title: string) => ((await call("GET", "/tasks?view=any")).json.tasks as T[]).filter((t) => t.title === title);
const reminder = async (name: string) => (await call("GET", "/reports")).json.reports.find((r: { name: string }) => r.name === name);

describe("reminders", () => {
  let today: string;
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
    today = (await call("GET", "/reports")).json.today;
  });

  it("a one-off reminder makes one task with its time and no labels", async () => {
    await call("POST", "/reports", { name: "District review meeting", startDate: today, dueTime: "14:30" });
    const t = await tasksNamed("District review meeting");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ dueDate: today, dueTime: "14:30", labelIds: [], status: "open" });
    expect((await reminder("District review meeting")).repeat).toBe("never");
  });

  it("the task appears only when Remind me says so", async () => {
    const in10 = new Date(Date.parse(`${today}T00:00:00Z`) + 10 * 86400_000).toISOString().slice(0, 10);
    await call("POST", "/reports", { name: "Pay electricity bill", startDate: in10, repeat: "monthly", leadDays: 3 });
    expect(await tasksNamed("Pay electricity bill")).toHaveLength(0);
    await call("POST", "/reports", { name: "Pay water bill", startDate: in10, repeat: "monthly", leadDays: 14 });
    expect((await tasksNamed("Pay water bill")).map((t) => t.dueDate)).toEqual([in10]);
  });

  it("marking an occurrence done completes its task, and editing never repeats an occurrence", async () => {
    await call("POST", "/reports", { name: "Weekly stock check", startDate: today, repeat: "weekly" });
    const [task] = await tasksNamed("Weekly stock check");
    await call("POST", `/reports/periods/${task!.report!.periodId}/submit`);
    expect((await tasksNamed("Weekly stock check"))[0]!.status).toBe("done");

    const r = await reminder("Weekly stock check");
    await call("PATCH", `/reports/${r.id}`, { repeat: "daily", dueTime: "09:00" });
    expect(await tasksNamed("Weekly stock check")).toHaveLength(1); // today's already exists; tomorrow's comes tomorrow
  });

  it("old reports are converted to reminders that carry on after their last period", async () => {
    // Apply the migrations before reminders, add a report the old way, then run the rest.
    const before = mkdtempSync(join(tmpdir(), "wd-mig-"));
    cpSync("drizzle", before, { recursive: true });
    const journalPath = join(before, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < "0012");
    writeFileSync(journalPath, JSON.stringify(journal));

    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: before });
    await d.execute(sql`insert into users (id, email) values ('00000000-0000-0000-0000-000000000001', 'clerk@example.gov.in')`);
    await d.execute(sql`insert into reports (id, user_id, name, frequency, due_day, due_month_offset, first_period_start, lead_days)
      values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Monthly HMIS report', 'monthly', 31, 1, '2026-07-01', 7),
             ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Annual report', 'annual', 30, 3, '2025-04-01', 30)`);
    // July's and August's periods already exist (due 31 Aug and 30 Sep).
    await d.execute(sql`insert into report_periods (user_id, report_id, period_start, period_end, label, due_date)
      values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2026-07-01', '2026-07-31', 'Jul 2026', '2026-08-31'),
             ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2026-08-01', '2026-08-31', 'Aug 2026', '2026-09-30')`);
    await migrate(d, { migrationsFolder: "drizzle" });

    const rows = (await d.execute(sql`select name, repeat, start_date::text, due_day from reports order by name`)).rows;
    expect(rows).toEqual([
      { name: "Annual report", repeat: "yearly", start_date: "2026-06-30", due_day: 30 },
      { name: "Monthly HMIS report", repeat: "monthly", start_date: "2026-08-31", due_day: 31 },
    ]);
    await ensureReportPeriods(d as unknown as DB, "2026-10-25");
    const due = (await d.execute(sql`select label, due_date::text from report_periods where report_id = '00000000-0000-0000-0000-0000000000a1' order by due_date`)).rows;
    expect(due).toEqual([
      { label: "Jul 2026", due_date: "2026-08-31" },
      { label: "Aug 2026", due_date: "2026-09-30" },
      { label: "31 Oct 2026", due_date: "2026-10-31" }, // the last day, as before
    ]);
  });
});
