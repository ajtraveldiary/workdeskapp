// Import / Export (user request 2026-10-07): the CSV columns of each list, shared by the server (export, import)
// and the app (sample CSV). Exports start with a BOM so Excel opens Malayalam correctly; imports accept the
// headers in any order and case, and the app also reads .xlsx files. Dates go out as YYYY-MM-DD and come back
// as YYYY-MM-DD or day-first (31/03/2027, 31-03-2027, 31.03.2027), as Excel in India saves them.

export const CSV_KINDS = ["files", "employees", "tasks", "reminders"] as const;
export type CsvKind = (typeof CSV_KINDS)[number];

export type CsvColumn = {
  key: string;
  header: string;
  // Two example rows for the sample file.
  sample: [string, string];
  // Only in exports; ignored on import.
  exportOnly?: boolean;
  required?: boolean;
};

export const CSV_TITLES: Record<CsvKind, string> = { files: "File register", employees: "Employees", tasks: "Tasks", reminders: "Reminders" };

// What a row is matched on (a match is updated, anything else is added; user's choice 2026-10-07).
export const CSV_MATCH: Record<CsvKind, string> = {
  files: "the same e-file number, or the same subject",
  employees: "the same PEN, or the same name",
  tasks: "the same ID (from an export), or the same title of an open task",
  reminders: "the same ID (from an export), or the same name",
};

export const CSV_COLUMNS: Record<CsvKind, CsvColumn[]> = {
  files: [
    { key: "subject", header: "Subject", required: true, sample: ["Professional Tax", "JPHN Establishment"] },
    { key: "kind", header: "Kind", sample: ["Physical file", "E-file"] },
    { key: "efileNumber", header: "E-file number", sample: ["255/2026", "340/2026"] },
    { key: "notes", header: "Notes", sample: ["Rack 3", ""] },
  ],
  employees: [
    { key: "name", header: "Name", required: true, sample: ["Lakshmi K S", "Anitha Kumari"] },
    { key: "employment", header: "Employment", sample: ["Permanent", "Temporary"] },
    { key: "designation", header: "Designation", sample: ["Junior Public Health Nurse (JPHN)", "Cleaning Staff"] },
    { key: "pen", header: "PEN", sample: ["765432", ""] },
    { key: "phone", header: "Phone", sample: ["9447012345", "9846012345"] },
    { key: "email", header: "Email", sample: ["lakshmi@example.com", ""] },
    { key: "category", header: "Category", sample: ["OBC", "General"] },
    { key: "dateOfBirth", header: "Date of birth", sample: ["1980-05-31", "1990-01-15"] },
    { key: "joinedServiceOn", header: "Date of joining", sample: ["2008-06-02", "2026-10-01"] },
    { key: "joinedOfficeOn", header: "Joined this office on", sample: ["2022-06-01", ""] },
    { key: "nextIncrementOn", header: "Next increment date", sample: ["2027-06-01", ""] },
    { key: "retiresOn", header: "Date of retirement", sample: ["2036-05-31", ""] },
    { key: "probationDeclaredOn", header: "Probation declared on", sample: ["2010-06-02", ""] },
    { key: "payScale", header: "Pay scale / basic pay", sample: ["35600-75400", ""] },
    { key: "address", header: "Home address", sample: ["Thiruvananthapuram", ""] },
    { key: "notes", header: "Notes", sample: ["", ""] },
    { key: "engagement", header: "Engaged as", sample: ["", "Daily wage"] },
    { key: "type", header: "Type", sample: ["", "NHM"] },
    { key: "contractDays", header: "Contract period (days)", sample: ["", "179"] },
    { key: "payPerDay", header: "Pay per day", sample: ["", "755"] },
    { key: "engagedTill", header: "Contract end date", sample: ["", "2027-03-28"] },
    { key: "leftOn", header: "Left the office on", sample: ["", ""] },
  ],
  tasks: [
    { key: "id", header: "ID", sample: ["", ""] },
    { key: "title", header: "Title", required: true, sample: ["Send salary bill", "Service book verification"] },
    { key: "notes", header: "Notes", sample: ["For October", ""] },
    { key: "dueDate", header: "Due date", sample: ["2026-10-20", ""] },
    { key: "dueTime", header: "Due time", sample: ["10:30", ""] },
    { key: "priority", header: "Priority", sample: ["High", "Medium"] },
    { key: "status", header: "Status", sample: ["Open", "Open"] },
    { key: "checklist", header: "Checklist", sample: ["Collect bills\n✓ Check totals", ""] },
    { key: "for", header: "For", sample: ["General office", "Lakshmi K S"] },
    { key: "email", header: "From email", exportOnly: true, sample: ["", ""] },
    { key: "reminder", header: "Reminder", exportOnly: true, sample: ["", ""] },
    { key: "waitingSince", header: "Waiting since", exportOnly: true, sample: ["", ""] },
    { key: "replyBy", header: "Reply by", exportOnly: true, sample: ["", ""] },
    { key: "completedOn", header: "Completed on", sample: ["", ""] },
    { key: "createdOn", header: "Created on", exportOnly: true, sample: ["", ""] },
  ],
  reminders: [
    { key: "id", header: "ID", sample: ["", ""] },
    { key: "name", header: "Name", required: true, sample: ["Monthly HMIS report", "Pay electricity bill"] },
    { key: "startDate", header: "Date", required: true, sample: ["2026-11-05", "2026-10-25"] },
    { key: "dueTime", header: "Time", sample: ["", "11:00"] },
    { key: "repeat", header: "Repeat", sample: ["Every month", "Every 2 weeks"] },
    { key: "endDate", header: "End repeat", sample: ["", "2027-03-31"] },
    { key: "leadDays", header: "Remind me (days before)", sample: ["3", "0"] },
    { key: "priority", header: "Priority", sample: ["High", "Medium"] },
    { key: "active", header: "Active", sample: ["Yes", "Yes"] },
    { key: "notes", header: "Notes", sample: ["Submit before the 5th", ""] },
    { key: "links", header: "Links", sample: ["HMIS sheet | https://docs.google.com/spreadsheets/d/example", ""] },
    { key: "for", header: "For", sample: ["General office", ""] },
    { key: "nextDue", header: "Next due", exportOnly: true, sample: ["", ""] },
    { key: "lastDone", header: "Last done", exportOnly: true, sample: ["", ""] },
  ],
};

// --- CSV writing ---

// A cell Excel would run as a formula (=, @, or + / - not followed by a digit) gets a leading ' so it stays text;
// import takes the ' off again. Phone numbers like +91… are left alone.
const risky = /^(?:[=@\t\r]|[+-](?!\d))/;
function cell(v: string): string {
  const s = risky.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
export function sampleCsv(kind: CsvKind): string {
  const cols = CSV_COLUMNS[kind].filter((c) => !c.exportOnly);
  return toCsv([cols.map((c) => c.header), cols.map((c) => c.sample[0]), cols.map((c) => c.sample[1])]);
}

// --- Reading what came in ---

export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// Which column each header of an uploaded file is (by header, or by key), and the headers we don't know.
export function mapHeaders(kind: CsvKind, headers: string[]): { keys: (string | null)[]; unknown: string[] } {
  const byName = new Map<string, string>();
  for (const c of CSV_COLUMNS[kind]) {
    byName.set(normHeader(c.header), c.key);
    byName.set(normHeader(c.key), c.key);
  }
  const keys = headers.map((h) => byName.get(normHeader(h)) ?? null);
  return { keys, unknown: headers.filter((h, i) => h.trim() && !keys[i]) };
}

export const cleanCell = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  return s.startsWith("'") ? s.slice(1) : s;
};

// "" → null; a bad date → undefined.
export function parseDay(s: string): string | null | undefined {
  const v = s.trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(v);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(v))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3]!.length === 2 ? `20${r[3]}` : r[3])];
  else return undefined;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(back.getTime()) && back.toISOString().slice(0, 10) === iso ? iso : undefined;
}

// "9:5", "09:05", "9.30", "10:30 AM" → "HH:MM"; "" → null; bad → undefined.
export function parseTime(s: string): string | null | undefined {
  const v = s.trim().toUpperCase();
  if (!v) return null;
  const r = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?$/.exec(v);
  if (!r) return undefined;
  let h = Number(r[1]);
  const m = Number(r[2]);
  if (r[3]) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (r[3] === "PM" ? 12 : 0);
  }
  return h < 24 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : undefined;
}

export function parseYesNo(s: string): boolean | null | undefined {
  const v = normHeader(s);
  if (!v) return null;
  if (["yes", "y", "true", "1", "active", "on"].includes(v)) return true;
  if (["no", "n", "false", "0", "paused", "off"].includes(v)) return false;
  return undefined;
}

export const PRIORITY_NAMES = { urgent: "Urgent", high: "High", normal: "Medium", low: "Low" } as const;
export function parsePriority(s: string): keyof typeof PRIORITY_NAMES | null | undefined {
  const v = normHeader(s);
  if (!v) return null;
  if (v === "medium" || v === "normal") return "normal";
  return (["urgent", "high", "low"] as const).find((p) => p === v);
}

// Rows sent to the server per request when importing (each update is a database call; a Worker request may
// make only a limited number).
export const IMPORT_CHUNK = 20;
// Backup rows per request.
export const BACKUP_CHUNK = 300;
export const MAX_IMPORT_ROWS = 5000;

export type ImportResult = {
  added: number;
  updated: number;
  // Rows left as they are on purpose (a reminder's task in a tasks file: it changes with its reminder).
  skipped: number;
  // Rows not imported, with the reason (row = line in the file, 2 = first row under the headers).
  problems: { row: number; message: string }[];
  // Designations / types made because a row named one that didn't exist (employees).
  created: string[];
  unknownColumns: string[];
};

// --- Master backup (one JSON file with WorkDesk's own records) ---
export const BACKUP_TABLES = [
  "designations",
  "employeeTypes",
  "employees",
  "officeFiles",
  "reports",
  "reportPeriods",
  "tasks",
  "events",
  "hiddenSnippets",
  "mutedSenders",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export const BACKUP_TABLE_NAMES: Record<BackupTable, string> = {
  designations: "Designations",
  employeeTypes: "Types of temporary employees",
  employees: "Employees",
  officeFiles: "File register",
  reports: "Reminders",
  reportPeriods: "Reminder dates",
  tasks: "Tasks",
  events: "History",
  hiddenSnippets: "Hidden text",
  mutedSenders: "Hidden senders",
};
export type Backup = { app: "WorkDesk"; version: 1; exportedAt: string; tables: Partial<Record<BackupTable, Record<string, unknown>[]>> };
