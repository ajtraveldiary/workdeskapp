// Import / Export (user request 2026-10-07): CSV import/export of the file register, employees, tasks and
// reminders (a matching row updates, others are added), sample files, and the master backup (adds only what
// is missing).
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { BACKUP_TABLES, CSV_COLUMNS, mapHeaders, parseDay, parseTime, sampleCsv, toCsv, type Backup } from "../src/shared/transfer";
import type { OfficeFile, StaffList, Task, Report } from "../src/shared/types";

const MAL = "2026-27 സാമ്പത്തിക വർഷത്തെ 2210-ഓൺലൈൻ റീകൺസിലിയേഷൻ പൂർത്തിയാക്കി ജില്ലാ മെഡിക്കൽ ഓഫീസർക്ക് റിപ്പോർട്ട്";

// A minimal CSV reader for the tests (the app reads files with SheetJS).
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"' && s[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cur), (cur = "");
    else if (ch === "\n") row.push(cur.replace(/\r$/, "")), rows.push(row), (row = []), (cur = "");
    else cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  return rows;
}

describe("import / export", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* CSV */
    }
    return { status: res.status, json, text };
  };
  const importCsv = async (kind: string, csv: string, dryRun = false) => {
    const [headers, ...rows] = readCsv(csv);
    return (await call("POST", `/transfer/${kind}/import`, { headers, rows, dryRun })).json;
  };
  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("reads dates and times the way Excel in India saves them", () => {
    expect(parseDay("2027-03-31")).toBe("2027-03-31");
    expect(parseDay("31/03/2027")).toBe("2027-03-31");
    expect(parseDay("1-4-2027")).toBe("2027-04-01");
    expect(parseDay("31.03.27")).toBe("2027-03-31");
    expect(parseDay("31/02/2027")).toBeUndefined();
    expect(parseDay("")).toBeNull();
    expect(parseTime("9.30")).toBe("09:30");
    expect(parseTime("2:05 PM")).toBe("14:05");
    expect(parseTime("25:00")).toBeUndefined();
    expect(mapHeaders("files", ["e-file NUMBER", "Subject", "Colour"])).toEqual({ keys: ["efileNumber", "subject", null], unknown: ["Colour"] });
    // Basic pay got its own column (2026-10-08); the old "Pay scale / basic pay" header still means the pay scale.
    expect(mapHeaders("employees", ["Pay scale / basic pay", "Pay scale", "Basic pay"]).keys).toEqual(["payScale", "payScale", "basicPay"]);
    // Formula-looking text is kept as text; phone numbers are left alone.
    expect(toCsv([["=SUM(A1)", "+91 9447012345", 'a "b", c']])).toBe('﻿\'=SUM(A1),+91 9447012345,"a ""b"", c"\r\n');
    for (const kind of ["files", "employees", "tasks", "reminders"] as const) {
      const [h, a] = readCsv(sampleCsv(kind));
      expect(h).toEqual(CSV_COLUMNS[kind].filter((c) => !c.exportOnly).map((c) => c.header));
      expect(a!.length).toBe(h!.length);
    }
  });

  it("file register: the sample imports, a matching e-file number or subject updates, export round-trips", async () => {
    const preview = await importCsv("files", sampleCsv("files"), true);
    expect(preview).toMatchObject({ added: 2, updated: 0, problems: [] });
    expect((await call("GET", "/files")).json.files).toEqual([]);
    await importCsv("files", sampleCsv("files"));
    let files = (await call("GET", "/files")).json.files as OfficeFile[];
    expect(files.map((f) => [f.subject, f.physical, f.efileNumber])).toEqual([
      ["JPHN Establishment", false, "340/2026"],
      ["Professional Tax", true, "255/2026"],
    ]);
    const r = await importCsv(
      "files",
      ["Subject,E-file number,Kind,Notes", `Professional Tax renamed,255/2026,,`, `${MAL},,Physical file,Rack 3`, `Again,340/2026,E-file,`, `Bad,,Folder,`, `,,,`].join("\n"),
    );
    expect(r).toMatchObject({ added: 1, updated: 2 });
    expect(r.problems).toEqual([{ row: 5, message: expect.stringContaining("Kind") }]);
    files = (await call("GET", "/files")).json.files;
    expect(files.map((f) => f.subject).sort()).toEqual([MAL, "Again", "Professional Tax renamed"].sort());
    const res = await app.request("/api/transfer/files/csv", {}, {});
    expect([...new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM for Excel
    const csv = await res.text();
    expect(csv.startsWith("Subject,Kind,E-file number,Notes")).toBe(true);
    expect(csv).toContain(MAL);
    // Importing its own export changes nothing new.
    expect(await importCsv("files", csv)).toMatchObject({ added: 0, updated: 3, problems: [] });
    expect(JSON.stringify((await call("GET", "/history")).json)).toContain("File register imported");
  });

  it("employees: designations and types are made by name, PEN matches, temporary rows keep only their details", async () => {
    const r = await importCsv("employees", sampleCsv("employees"));
    expect(r).toMatchObject({ added: 2, updated: 0, problems: [] });
    expect(r.created.sort()).toEqual(["Designation: Cleaning Staff", "Designation: Junior Public Health Nurse (JPHN)", "Type: NHM"].sort());
    let staff = (await call("GET", "/staff")).json as StaffList;
    const lakshmi = staff.employees.find((e) => e.name === "Lakshmi K S")!;
    expect(lakshmi).toMatchObject({ permanent: true, pen: "765432", category: "OBC", dateOfBirth: "1980-05-31", nextIncrementOn: "2027-06-01" });
    const anitha = staff.employees.find((e) => e.name === "Anitha Kumari")!;
    expect(anitha).toMatchObject({ permanent: false, engagement: "daily_wage", contractDays: 179, payPerDay: 755, engagedTill: "2027-03-28", typeId: staff.types[0]!.id });
    // No end date given: worked out from joining + days, as in the form.
    await importCsv("employees", "Name,Employment,Date of joining,Contract period (days)\nNew contract,Temporary,01/10/2026,179");
    expect(((await call("GET", "/staff")).json as StaffList).employees.find((e) => e.name === "New contract")?.engagedTill).toBe("2027-03-28");
    // Same PEN, new name and phone: updated; only the columns in the file change.
    const r2 = await importCsv("employees", ["PEN,Name,Phone,Date of birth", `765432,${MAL},+91 9447000000,31/05/1980`, "999,Bad date,,31/02/1980"].join("\n"));
    expect(r2).toMatchObject({ added: 0, updated: 1 });
    expect(r2.problems[0].message).toContain("Date of birth");
    staff = (await call("GET", "/staff")).json;
    expect(staff.employees.find((e) => e.pen === "765432")).toMatchObject({ name: MAL, phone: "+91 9447000000", category: "OBC", nextIncrementOn: "2027-06-01" });
    // Export and import again: nothing added, no problems.
    const again = await importCsv("employees", (await call("GET", "/transfer/employees/csv")).text);
    expect(again).toMatchObject({ added: 0, updated: 3, problems: [], created: [] });
  });

  it("tasks: new ones added, same title or ID updated, reminder tasks left alone, For by name", async () => {
    await importCsv("employees", "Name,Designation\nLakshmi K S,Senior Clerk");
    const r = await importCsv(
      "tasks",
      ["Title,Due date,Due time,Priority,Checklist,For,Status,Completed on", `${MAL},20/10/2026,10:30,High,"Collect bills\n✓ Check totals",Lakshmi K S,,`, "Old job,01/09/2026,,Low,,Senior Clerk (all),Completed,02/09/2026", "Wrong,,,,,Nobody,,"].join("\n"),
    );
    expect(r).toMatchObject({ added: 2, updated: 0 });
    expect(r.problems).toEqual([{ row: 4, message: expect.stringContaining("Nobody") }]);
    const all = (await call("GET", "/tasks?view=any")).json.tasks as Task[];
    const mine = all.find((t) => t.title === MAL)!;
    expect(mine).toMatchObject({ dueDate: "2026-10-20", dueTime: "10:30", priority: "high", relatedKind: "employee", status: "open" });
    expect(mine.checklist.map((s) => [s.text, s.done])).toEqual([["Collect bills", false], ["Check totals", true]]);
    const old = (await call("GET", "/tasks?view=completed")).json.tasks.find((t: Task) => t.title === "Old job");
    expect(old).toMatchObject({ status: "done", relatedKind: "designation" });
    // Same title → updated (not duplicated).
    expect(await importCsv("tasks", `Title,Priority\n${MAL},Urgent`)).toMatchObject({ added: 0, updated: 1 });
    // The export round-trips.
    const csv = (await call("GET", "/transfer/tasks/csv")).text;
    expect(csv).toContain("✓ Check totals");
    const again = await importCsv("tasks", csv);
    expect(again).toMatchObject({ added: 0, problems: [] });
    expect(again.updated).toBeGreaterThanOrEqual(2);
  });

  it("reminders: added with their first task, updated by name, links and repeat read", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const r = await importCsv(
      "reminders",
      ["Name,Date,Time,Repeat,Remind me (days before),Priority,Links,For", `${MAL},${today},11:00,Every month,0,High,"Sheet | docs.google.com/spreadsheets/d/x",General office`, "Bad,someday,,,,,,"].join("\n"),
    );
    expect(r).toMatchObject({ added: 1, updated: 0 });
    expect(r.problems[0].message).toContain("Date");
    const mine = async () => ((await call("GET", "/reports")).json.reports as Report[]).find((x) => x.name === MAL)!;
    expect(await mine()).toMatchObject({ name: MAL, repeat: "monthly", dueTime: "11:00", priority: "high", relatedKind: "office", links: [{ name: "Sheet", url: "https://docs.google.com/spreadsheets/d/x" }] });
    expect((await mine()).periods.length).toBe(1);
    expect(await importCsv("reminders", `Name,Active\n${MAL},No`)).toMatchObject({ updated: 1 });
    expect((await mine()).active).toBe(false);
    // A reminder's task in a tasks CSV is left as it is.
    const tasksCsv = (await call("GET", "/transfer/tasks/csv")).text;
    const t = await importCsv("tasks", tasksCsv);
    expect(t.skipped).toBeGreaterThanOrEqual(1);
    expect(t.problems).toEqual([]);
    expect(await importCsv("reminders", (await call("GET", "/transfer/reminders/csv")).text)).toMatchObject({ added: 0, problems: [] });
  });

  it("master backup: downloads everything, importing adds only what is missing", async () => {
    await importCsv("files", sampleCsv("files"));
    await importCsv("employees", sampleCsv("employees"));
    await importCsv("tasks", `Title,Checklist\n${MAL},"a\nb"`);
    await importCsv("reminders", "Name,Date\nMonthly HMIS report,2026-10-05");
    const backup = (await call("GET", "/transfer/backup")).json as Backup;
    expect(backup).toMatchObject({ app: "WorkDesk", version: 1 });
    expect(Object.keys(backup.tables)).toEqual([...BACKUP_TABLES]);
    expect(JSON.stringify(backup)).not.toContain("userId");
    // Into the same account: nothing new.
    for (const t of BACKUP_TABLES) expect((await call("POST", "/transfer/backup", { table: t, rows: backup.tables[t] })).json).toEqual({ added: 0 });

    // Into an empty WorkDesk: everything comes back, links between them too.
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
    let added = 0;
    for (const t of BACKUP_TABLES) added += (await call("POST", "/transfer/backup", { table: t, rows: backup.tables[t] })).json.added;
    expect(added).toBeGreaterThan(8);
    await call("POST", "/transfer/backup/done", { added: { tasks: added } });
    const staff = (await call("GET", "/staff")).json as StaffList;
    expect(staff.employees.find((e) => e.name === "Anitha Kumari")?.typeId).toBe(backup.tables.employeeTypes![0]!.id);
    const tasks = (await call("GET", "/tasks?view=any")).json.tasks as Task[];
    expect(tasks.find((t) => t.title === MAL)?.checklist.map((s) => s.text)).toEqual(["a", "b"]);
    expect((await call("GET", "/files")).json.files.length).toBe(2);
    expect((await call("POST", "/transfer/backup", { table: "users", rows: [] })).status).toBe(400);
  });
});
