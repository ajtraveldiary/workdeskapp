// Private calendar link for Apple Calendar etc. (user request 2026-10-07).
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { buildCalendar, escapeText, foldLine, localToUtc } from "../src/server/lib/ics";

describe("calendar file", () => {
  it("writes timed tasks in UTC and the rest as all-day events", () => {
    expect(localToUtc("2026-10-10", "09:30", "Asia/Kolkata").toISOString()).toBe("2026-10-10T04:00:00.000Z");
    const ics = buildCalendar({
      tasks: [
        { id: "t1", title: "Send report, urgent; today", notes: "line 1\nline 2", dueDate: "2026-10-10", dueTime: "09:30", priority: "high", updatedAt: new Date(), email: { from: "DMO", subject: "Monthly report" } },
        { id: "t2", title: "Pay bill", notes: "", dueDate: "2026-10-12", dueTime: null, priority: "normal", updatedAt: new Date(), email: null },
      ],
      reminders: [
        { id: "r1", name: "HMIS report", notes: "", dueTime: null, updatedAt: new Date(), repeat: "monthly", startDate: "2026-09-05", dueDay: 5, endDate: null, doneDates: new Set(["2026-10-05"]), overdueDates: new Set() },
      ],
      today: "2026-10-07",
      tz: "Asia/Kolkata",
      appUrl: "https://workdesk.example",
      now: new Date("2026-10-07T00:00:00Z"),
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261010T040000Z");
    expect(ics).toContain("DTEND:20261010T043000Z");
    expect(ics).toContain("SUMMARY:Send report\\, urgent\\; today");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261012");
    expect(ics).toContain("DTEND;VALUE=DATE:20261013");
    // Monthly reminder: past month, this month (done ✓) and the year ahead.
    expect(ics).toContain("UID:reminder-r1-2026-09-05@workdesk");
    expect(ics).toContain("SUMMARY:✓ HMIS report");
    expect(ics).toContain("UID:reminder-r1-2027-10-05@workdesk");
    expect(ics).not.toContain("reminder-r1-2027-11-05");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("moves overdue tasks and reminder dates to today", () => {
    const ics = buildCalendar({
      tasks: [{ id: "late", title: "File returns", notes: "", dueDate: "2026-09-18", dueTime: "09:30", priority: "urgent", updatedAt: new Date(), email: null }],
      reminders: [
        { id: "r2", name: "Staff meeting", notes: "", dueTime: "10:30", updatedAt: new Date(), repeat: "weekly", startDate: "2026-09-23", dueDay: 23, endDate: null, doneDates: new Set(["2026-09-23"]), overdueDates: new Set(["2026-09-30"]) },
      ],
      today: "2026-10-07",
      tz: "Asia/Kolkata",
      appUrl: "https://workdesk.example",
    });
    const ev = (uid: string) => ics.split("BEGIN:VEVENT").find((e) => e.includes(`UID:${uid}`))!;
    const task = ev("task-late@workdesk");
    expect(task).toContain("DTSTART;VALUE=DATE:20261007");
    expect(task).toContain("SUMMARY:Overdue: File returns");
    expect(task).toContain("Overdue – was due 18 Sept 2026\\, 09:30");
    expect(ev("reminder-r2-2026-09-30@workdesk")).toContain("DTSTART;VALUE=DATE:20261007");
    expect(ev("reminder-r2-2026-09-30@workdesk")).toContain("SUMMARY:Overdue: Staff meeting");
    expect(ev("reminder-r2-2026-09-23@workdesk")).toContain("SUMMARY:✓ Staff meeting"); // done: stays on its day
    expect(ev("reminder-r2-2026-10-14@workdesk")).toContain("DTSTART:20261014T050000Z"); // still to come: as before
  });

  it("escapes text and folds long lines without breaking Malayalam letters", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = "SUMMARY:" + "പൾസ് പോളിയോ ഇമ്മ്യൂണൈസേഷൻ ".repeat(4);
    const folded = foldLine(long);
    expect(folded.split("\r\n ").join("")).toBe(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });
});

describe("calendar link", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string) => {
    const res = await app.request(`/api${path}`, { method }, {});
    return { status: res.status, type: res.headers.get("content-type"), text: await res.text() };
  };
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    app = createApp({ getDb: () => d as unknown as DB, allowDemo: true });
  });

  it("makes a working private link, can replace it and turn it off", async () => {
    expect(JSON.parse((await call("GET", "/calendar-link")).text)).toEqual({ url: null });
    const url = JSON.parse((await call("POST", "/calendar-link")).text).url as string;
    expect(url).toMatch(/\/api\/calendar\/[\w-]{20,}\.ics$/);
    const path = url.slice(url.indexOf("/api") + 4);
    const feed = await call("GET", path);
    expect(feed.status).toBe(200);
    expect(feed.type).toContain("text/calendar");
    expect(feed.text).toContain("X-WR-CALNAME:WorkDesk");
    expect(feed.text).toContain("BEGIN:VEVENT"); // the demo user's tasks and reminders
    expect((await call("GET", "/calendar/not-a-real-token-1234567890.ics")).status).toBe(404);
    // A new link stops the old one.
    const url2 = JSON.parse((await call("POST", "/calendar-link")).text).url as string;
    expect(url2).not.toBe(url);
    expect((await call("GET", path)).status).toBe(404);
    await call("DELETE", "/calendar-link");
    expect((await call("GET", url2.slice(url2.indexOf("/api") + 4))).status).toBe(404);
  });
});
