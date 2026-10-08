// Import / Export (user request 2026-10-07; user's choices: a master backup whose import only adds what is
// missing, CSV import/export for the file register, employees, tasks and reminders, and a CSV row that matches
// an existing entry updates it). Only WorkDesk's database changes; Gmail is never touched. Every import writes a
// History entry.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, getTableColumns, inArray, isNull, max } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import {
  designations,
  emailThreads,
  employeeTypes,
  employees,
  events,
  hiddenSnippets,
  mutedSenders,
  officeFiles,
  reportPeriods,
  reports,
  tasks,
} from "../db/schema";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";
import { ensureReportPeriods } from "../lib/reports";
import { ensurePensionTasks } from "../lib/pension";
import { ensureContractTasks } from "../lib/contracts";
import { employeeInput, officeFileInput, reminderLinks, reportInput, reportPatch, taskInput, taskPatch } from "../../shared/schemas";
import { EMPLOYEE_CATEGORIES, ENGAGEMENTS, ENGAGEMENT_LABELS, contractEnd, type Engagement } from "../../shared/staff";
import { REPEATS, REPEAT_LABEL } from "../../shared/reminderSchedule";
import {
  BACKUP_TABLES,
  CSV_COLUMNS,
  CSV_KINDS,
  CSV_TITLES,
  MAX_IMPORT_ROWS,
  PRIORITY_NAMES,
  cleanCell,
  mapHeaders,
  normHeader,
  parseDay,
  parsePriority,
  parseTime,
  parseYesNo,
  toCsv,
  type BackupTable,
  type CsvKind,
  type ImportResult,
} from "../../shared/transfer";
import { employeeValues } from "./staff";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });
const lower = (s: string) => s.trim().toLowerCase();
const isKind = (k: string): k is CsvKind => (CSV_KINDS as readonly string[]).includes(k);
const zodMessage = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ");

// --- Staff names for the "For" column (tasks and reminders) ---

type StaffNames = { designations: { id: string; name: string }[]; employees: { id: string; name: string; leftOn: string | null }[] };
async function staffNames(db: DB, userId: string): Promise<StaffNames> {
  const [d, e] = await Promise.all([
    db.select({ id: designations.id, name: designations.name }).from(designations).where(eq(designations.userId, userId)).orderBy(asc(designations.sortOrder)),
    db.select({ id: employees.id, name: employees.name, leftOn: employees.leftOn }).from(employees).where(eq(employees.userId, userId)),
  ]);
  return { designations: d, employees: e };
}
function forName(s: StaffNames, kind: string | null, id: string | null): string {
  if (kind === "office") return "General office";
  if (kind === "employee") return s.employees.find((e) => e.id === id)?.name ?? "";
  if (kind === "designation") {
    const d = s.designations.find((x) => x.id === id);
    return d ? `${d.name} (all)` : "";
  }
  return "";
}
// "" → nothing; "General office"; an employee's name (still here first); "<designation> (all)" or a designation.
function parseFor(s: StaffNames, v: string): { relatedKind: "employee" | "designation" | "office" | null; relatedId: string | null } | string {
  const t = lower(v);
  if (!t) return { relatedKind: null, relatedId: null };
  if (t === "general office" || t === "office") return { relatedKind: "office", relatedId: null };
  const people = s.employees.filter((e) => lower(e.name) === t).sort((a, b) => Number(!!a.leftOn) - Number(!!b.leftOn));
  if (people[0]) return { relatedKind: "employee", relatedId: people[0].id };
  const dn = t.replace(/\s*\(all\)$/, "");
  const d = s.designations.find((x) => lower(x.name) === dn);
  if (d) return { relatedKind: "designation", relatedId: d.id };
  return `For: no employee or designation called "${v.trim()}"`;
}

// --- Exports ---

const dayOf = (d: Date | null, tz: string) => (d ? todayIn(tz, d) : "");
const checklistText = (items: { text: string; done: boolean }[]) => items.map((i) => `${i.done ? "✓ " : ""}${i.text}`).join("\n");

async function exportRows(db: DB, userId: string, kind: CsvKind, tz: string): Promise<string[][]> {
  const cols = CSV_COLUMNS[kind];
  const out = (o: Record<string, string>) => cols.map((c) => o[c.key] ?? "");
  if (kind === "files") {
    const rows = await db.select().from(officeFiles).where(eq(officeFiles.userId, userId)).orderBy(asc(officeFiles.subject));
    return rows.map((f) => out({ subject: f.subject, kind: f.physical ? "Physical file" : "E-file", efileNumber: f.efileNumber, notes: f.notes }));
  }
  if (kind === "employees") {
    const [rows, d, t] = await Promise.all([
      db.select().from(employees).where(eq(employees.userId, userId)).orderBy(asc(employees.name)),
      db.select().from(designations).where(eq(designations.userId, userId)),
      db.select().from(employeeTypes).where(eq(employeeTypes.userId, userId)),
    ]);
    const dn = new Map(d.map((x) => [x.id, x.name]));
    const tn = new Map(t.map((x) => [x.id, x.name]));
    return rows.map((e) =>
      out({
        ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v == null ? "" : String(v)])),
        employment: e.permanent ? "Permanent" : "Temporary",
        designation: dn.get(e.designationId ?? "") ?? "",
        type: tn.get(e.typeId ?? "") ?? "",
        engagement: ENGAGEMENT_LABELS[e.engagement as Engagement] ?? "",
      }),
    );
  }
  const staff = await staffNames(db, userId);
  if (kind === "tasks") {
    const rows = await db
      .select({ t: tasks, subject: emailThreads.subject, reminder: reports.name })
      .from(tasks)
      .leftJoin(emailThreads, eq(tasks.threadId, emailThreads.id))
      .leftJoin(reportPeriods, eq(tasks.reportPeriodId, reportPeriods.id))
      .leftJoin(reports, eq(reportPeriods.reportId, reports.id))
      .where(eq(tasks.userId, userId))
      .orderBy(asc(tasks.status), asc(tasks.dueDate), asc(tasks.createdAt));
    return rows.map(({ t, subject, reminder }) =>
      out({
        id: t.id,
        title: t.title,
        notes: t.notes,
        dueDate: t.dueDate ?? "",
        dueTime: t.dueTime ?? "",
        priority: PRIORITY_NAMES[t.priority],
        status: t.status === "done" ? "Completed" : "Open",
        checklist: checklistText(t.checklist ?? []),
        for: forName(staff, t.relatedKind, t.relatedId),
        email: t.threadId ? subject || "(no subject)" : "",
        reminder: reminder ?? "",
        waitingSince: dayOf(t.waitingSince, tz),
        replyBy: t.replyBy ?? "",
        completedOn: dayOf(t.completedAt, tz),
        createdOn: dayOf(t.createdAt, tz),
      }),
    );
  }
  const [rows, periods] = await Promise.all([
    db.select().from(reports).where(eq(reports.userId, userId)).orderBy(asc(reports.name)),
    db.select({ reportId: reportPeriods.reportId, dueDate: reportPeriods.dueDate, status: reportPeriods.status }).from(reportPeriods).where(eq(reportPeriods.userId, userId)),
  ]);
  return rows.map((r) => {
    const mine = periods.filter((p) => p.reportId === r.id);
    const next = mine.filter((p) => p.status === "pending").map((p) => p.dueDate).sort()[0] ?? "";
    const done = mine.filter((p) => p.status === "submitted").map((p) => p.dueDate).sort().at(-1) ?? "";
    return out({
      id: r.id,
      name: r.name,
      startDate: r.startDate,
      dueTime: r.dueTime ?? "",
      repeat: REPEAT_LABEL[r.repeat],
      endDate: r.endDate ?? "",
      leadDays: String(r.leadDays),
      priority: PRIORITY_NAMES[r.priority],
      active: r.active ? "Yes" : "No",
      notes: r.notes,
      links: (r.links ?? []).map((l) => (l.name ? `${l.name} | ${l.url}` : l.url)).join("\n"),
      for: forName(staff, r.relatedKind, r.relatedId),
      nextDue: next,
      lastDone: done,
    });
  });
}

// --- Imports ---

type Row = { line: number; cells: Map<string, string> };
type Plan = { result: ImportResult; write: () => Promise<void> };

const problem = (r: ImportResult, row: Row, message: string) => r.problems.push({ row: row.line, message });

function num(v: string, int: boolean): number | null | undefined {
  const t = v.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && (!int || Number.isInteger(n)) ? n : undefined;
}

// A date column into `into[key]`; returns an error message for a bad one.
function setDay(row: Row, key: string, header: string, into: Record<string, unknown>): string | null {
  if (!row.cells.has(key)) return null;
  const d = parseDay(row.cells.get(key)!);
  if (d === undefined) return `${header}: "${row.cells.get(key)}" is not a date (use 31/03/2027 or 2027-03-31)`;
  into[key] = d;
  return null;
}

async function planFiles(db: DB, userId: string, rows: Row[], result: ImportResult): Promise<Plan> {
  const existing = await db.select().from(officeFiles).where(eq(officeFiles.userId, userId));
  type Entry = { id: string | null; subject: string; physical: boolean; efileNumber: string; notes: string; line: number };
  const entries: Entry[] = existing.map((f) => ({ id: f.id, subject: f.subject, physical: f.physical, efileNumber: f.efileNumber, notes: f.notes, line: 0 }));
  const touched = new Set<Entry>();
  for (const row of rows) {
    const c = row.cells;
    const efile = lower(c.get("efileNumber") ?? "");
    const subject = lower(c.get("subject") ?? "");
    const match = (efile && entries.find((e) => lower(e.efileNumber) === efile)) || (subject && entries.find((e) => lower(e.subject) === subject && (!efile || !e.efileNumber))) || null;
    const next = { ...(match ?? { id: null, subject: "", physical: true, efileNumber: "", notes: "", line: row.line }) };
    for (const k of ["subject", "efileNumber", "notes"] as const) if (c.has(k)) next[k] = c.get(k)!;
    if (c.has("kind") && c.get("kind")) {
      const k = normHeader(c.get("kind")!);
      if (["physical", "physicalfile", "file", "old", "oldfile"].includes(k)) next.physical = true;
      else if (["efile", "newefile", "e", "eoffice"].includes(k)) next.physical = false;
      else {
        problem(result, row, `Kind: "${c.get("kind")}" should be Physical file or E-file`);
        continue;
      }
    }
    const parsed = officeFileInput.safeParse(next);
    if (!parsed.success) {
      problem(result, row, zodMessage(parsed.error));
      continue;
    }
    const clash = parsed.data.efileNumber && entries.find((e) => e !== match && lower(e.efileNumber) === lower(parsed.data.efileNumber));
    if (clash) {
      problem(result, row, `E-file number ${parsed.data.efileNumber} is already on "${clash.subject}"`);
      continue;
    }
    if (match) {
      Object.assign(match, parsed.data);
      if (match.id && !touched.has(match)) result.updated++;
      touched.add(match);
    } else {
      const e = { id: null, line: row.line, ...parsed.data };
      entries.push(e);
      touched.add(e);
      result.added++;
    }
  }
  return {
    result,
    write: async () => {
      const add = [...touched].filter((e) => !e.id);
      for (const e of touched) if (e.id) await db.update(officeFiles).set({ subject: e.subject, physical: e.physical, efileNumber: e.efileNumber, notes: e.notes, updatedAt: new Date() }).where(eq(officeFiles.id, e.id));
      if (add.length) await db.insert(officeFiles).values(add.map((e) => ({ userId, subject: e.subject, physical: e.physical, efileNumber: e.efileNumber, notes: e.notes })));
    },
  };
}

async function planEmployees(db: DB, userId: string, rows: Row[], result: ImportResult): Promise<Plan> {
  const [existing, d, t] = await Promise.all([
    db.select().from(employees).where(eq(employees.userId, userId)),
    db.select().from(designations).where(eq(designations.userId, userId)),
    db.select().from(employeeTypes).where(eq(employeeTypes.userId, userId)),
  ]);
  const desig = new Map(d.map((x) => [lower(x.name), x.id]));
  const types = new Map(t.map((x) => [lower(x.name), x.id]));
  // New designations / types named in the file: made when the import runs (key "new:<name>").
  const newDesig = new Map<string, string>();
  const newTypes = new Map<string, string>();
  type Entry = { id: string | null; values: Record<string, unknown> };
  const entries: Entry[] = existing.map((e) => ({ id: e.id, values: { ...e } }));
  const touched = new Set<Entry>();
  const dateCols = CSV_COLUMNS.employees.filter((c) => /On$|Till$|dateOf/.test(c.key));

  for (const row of rows) {
    const c = row.cells;
    const pen = (c.get("pen") ?? "").trim();
    const name = lower(c.get("name") ?? "");
    const match = (pen && entries.find((e) => (e.values.pen as string) === pen)) || (name && entries.find((e) => lower(e.values.name as string) === name)) || null;
    const v: Record<string, unknown> = { ...(match?.values ?? { permanent: true, designationId: null, typeId: null, leftOn: null }) };
    const errors: string[] = [];
    for (const k of ["name", "pen", "phone", "email", "payScale", "address", "notes"]) if (c.has(k)) v[k] = c.get(k)!;
    for (const col of dateCols) {
      const err = setDay(row, col.key, col.header, v);
      if (err) errors.push(err);
    }
    if (c.has("employment") && c.get("employment")) {
      const k = normHeader(c.get("employment")!);
      if (k === "permanent" || k === "regular") v.permanent = true;
      else if (k === "temporary" || k === "contract" || k === "dailywage") {
        v.permanent = false;
        if (k !== "temporary" && !c.get("engagement")) v.engagement = k === "contract" ? "contract" : "daily_wage";
      } else errors.push(`Employment: "${c.get("employment")}" should be Permanent or Temporary`);
    }
    if (c.has("category")) {
      const cat = EMPLOYEE_CATEGORIES.find((x) => lower(x) === lower(c.get("category")!));
      if (c.get("category") && !cat) errors.push(`Category: "${c.get("category")}" should be one of ${EMPLOYEE_CATEGORIES.join(", ")}`);
      else v.category = cat ?? "";
    }
    if (c.has("engagement")) {
      const k = normHeader(c.get("engagement")!);
      const g = ENGAGEMENTS.find((x) => normHeader(x) === k || normHeader(ENGAGEMENT_LABELS[x]) === k);
      if (k && !g) errors.push(`Engaged as: "${c.get("engagement")}" should be Contract, Daily wage or Temporary`);
      else v.engagement = g ?? "";
    }
    for (const [key, header] of [["contractDays", "Contract period (days)"], ["payPerDay", "Pay per day"]] as const) {
      if (!c.has(key)) continue;
      const n = num(c.get(key)!, key === "contractDays");
      if (n === undefined) errors.push(`${header}: "${c.get(key)}" is not a number`);
      else v[key] = n;
    }
    if (c.has("designation")) {
      const n = c.get("designation")!.trim();
      if (!n) v.designationId = null;
      else if (desig.has(lower(n))) v.designationId = desig.get(lower(n));
      else {
        if (!newDesig.has(lower(n))) newDesig.set(lower(n), n);
        v.designationId = `new:${lower(n)}`;
      }
    }
    if (c.has("type")) {
      const n = c.get("type")!.trim();
      if (!n) v.typeId = null;
      else if (types.has(lower(n))) v.typeId = types.get(lower(n));
      else {
        if (!newTypes.has(lower(n))) newTypes.set(lower(n), n);
        v.typeId = `new:${lower(n)}`;
      }
    }
    if (errors.length) {
      problem(result, row, errors.join("; "));
      continue;
    }
    // Checked with the designation / type left out (new ones have no id yet).
    const parsed = employeeInput.safeParse({ ...v, designationId: null, typeId: null });
    if (!parsed.success) {
      problem(result, row, zodMessage(parsed.error));
      continue;
    }
    const values = { ...employeeValues({ ...parsed.data, designationId: null, typeId: null }), designationId: v.designationId ?? null, typeId: parsed.data.permanent ? null : (v.typeId ?? null), leftOn: v.leftOn ?? null };
    // As in the form: a contract's end date from its date of joining and length, when not given.
    if (!values.permanent && !values.engagedTill && values.joinedServiceOn && values.contractDays) values.engagedTill = contractEnd(values.joinedServiceOn, values.contractDays);
    if (match) {
      match.values = { ...match.values, ...values };
      if (match.id && !touched.has(match)) result.updated++;
      touched.add(match);
    } else {
      const e = { id: null, values };
      entries.push(e);
      touched.add(e);
      result.added++;
    }
  }
  result.created = [...[...newDesig.values()].map((n) => `Designation: ${n}`), ...[...newTypes.values()].map((n) => `Type: ${n}`)];

  return {
    result,
    write: async () => {
      const ids = new Map<string, string>();
      const used = (col: string, key: string) => [...touched].some((e) => e.values[col] === `new:${key}`);
      const make = async (table: typeof designations | typeof employeeTypes, names: Map<string, string>, col: string) => {
        const list = [...names].filter(([k]) => used(col, k));
        if (!list.length) return;
        const [m] = await db.select({ m: max(table.sortOrder) }).from(table).where(eq(table.userId, userId));
        const made = await db.insert(table).values(list.map(([, n], i) => ({ userId, name: n, sortOrder: (m?.m ?? 0) + 1 + i }))).returning({ id: table.id, name: table.name });
        for (const x of made) ids.set(`${col}:new:${lower(x.name)}`, x.id);
      };
      await make(designations, newDesig, "designationId");
      await make(employeeTypes, newTypes, "typeId");
      const fix = (e: Entry) => {
        const out = { ...e.values };
        for (const col of ["designationId", "typeId"]) if (typeof out[col] === "string" && (out[col] as string).startsWith("new:")) out[col] = ids.get(`${col}:${out[col]}`) ?? null;
        const { id: _i, userId: _u, createdAt: _c, updatedAt: _up, ...rest } = out;
        return rest as typeof employees.$inferInsert;
      };
      for (const e of touched) if (e.id) await db.update(employees).set({ ...fix(e), updatedAt: new Date() }).where(eq(employees.id, e.id));
      const add = [...touched].filter((e) => !e.id);
      if (add.length) await db.insert(employees).values(add.map((e) => ({ ...fix(e), userId })));
    },
  };
}

function parseChecklist(v: string) {
  return v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((l) => {
      const done = /^(✓|✔|\[x\]|x\s)/i.test(l);
      return { id: crypto.randomUUID(), text: l.replace(/^(✓|✔|\[x\]|\[ \]|x\s)\s*/i, "").slice(0, 500), done };
    });
}

async function planTasks(db: DB, userId: string, rows: Row[], result: ImportResult): Promise<Plan> {
  const ids = [...new Set(rows.map((r) => (r.cells.get("id") ?? "").trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const [byIdRows, openHand, staff] = await Promise.all([
    ids.length ? db.select({ id: tasks.id, title: tasks.title, reportPeriodId: tasks.reportPeriodId }).from(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.id, ids))) : Promise.resolve([]),
    db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "open"), isNull(tasks.threadId), isNull(tasks.reportPeriodId))),
    staffNames(db, userId),
  ]);
  const byId = new Map(byIdRows.map((t) => [t.id, t]));
  const updates = new Map<string, Record<string, unknown>>();
  const inserts: { title: string; values: Record<string, unknown> }[] = [];
  const today = todayIn("UTC");

  for (const row of rows) {
    const c = row.cells;
    const id = (c.get("id") ?? "").trim();
    const title = lower(c.get("title") ?? "");
    const found = byId.get(id);
    if (found?.reportPeriodId) {
      result.skipped++;
      continue;
    }
    const matchId = found?.id ?? (title ? openHand.find((t) => lower(t.title) === title)?.id : undefined);
    const pendingInsert = !matchId && title ? inserts.find((i) => lower(i.title) === title) : undefined;
    const v: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const k of ["title", "notes"]) if (c.has(k)) v[k] = c.get(k)!;
    const err = setDay(row, "dueDate", "Due date", v);
    if (err) errors.push(err);
    if (c.has("dueTime")) {
      const tm = parseTime(c.get("dueTime")!);
      if (tm === undefined) errors.push(`Due time: "${c.get("dueTime")}" is not a time (use 10:30)`);
      else v.dueTime = tm;
    }
    if (c.has("priority")) {
      const p = parsePriority(c.get("priority")!);
      if (p === undefined) errors.push(`Priority: "${c.get("priority")}" should be Urgent, High, Medium or Low`);
      else if (p) v.priority = p;
    }
    if (c.has("checklist")) v.checklist = parseChecklist(c.get("checklist")!);
    if (c.has("for")) {
      const f = parseFor(staff, c.get("for")!);
      if (typeof f === "string") errors.push(f);
      else Object.assign(v, f);
    }
    let status: "open" | "done" = "open";
    let completedAt: Date | null = null;
    if (c.has("status") && c.get("status")) {
      const s = normHeader(c.get("status")!);
      if (["completed", "complete", "done", "closed"].includes(s)) status = "done";
      else if (!["open", "pending", "todo"].includes(s)) errors.push(`Status: "${c.get("status")}" should be Open or Completed`);
    }
    if (status === "done") {
      const d = parseDay(c.get("completedOn") ?? "");
      completedAt = d ? new Date(`${d}T12:00:00Z`) : new Date();
      if (d && d > today) completedAt = new Date();
    }
    if (errors.length) {
      problem(result, row, errors.join("; "));
      continue;
    }
    if (matchId) {
      // An existing task: only the columns in the file change (its status is changed in WorkDesk itself).
      const parsed = taskPatch.safeParse(v);
      if (!parsed.success) {
        problem(result, row, zodMessage(parsed.error));
        continue;
      }
      if (!updates.has(matchId)) result.updated++;
      updates.set(matchId, { ...(updates.get(matchId) ?? {}), ...parsed.data });
      continue;
    }
    const parsed = taskInput.safeParse(pendingInsert ? { ...pendingInsert.values, ...v } : v);
    if (!parsed.success) {
      problem(result, row, zodMessage(parsed.error));
      continue;
    }
    const { waiting: _w, replyBy: _r, labelIds: _l, ...values } = parsed.data;
    if (pendingInsert) Object.assign(pendingInsert, { title: lower(values.title), values: { ...values, status, completedAt } });
    else {
      inserts.push({ title: lower(values.title), values: { ...values, status, completedAt } });
      result.added++;
    }
  }
  return {
    result,
    write: async () => {
      for (const [id, set] of updates) await db.update(tasks).set({ ...set, updatedAt: new Date() }).where(eq(tasks.id, id));
      if (inserts.length) await db.insert(tasks).values(inserts.map((i) => ({ ...(i.values as typeof tasks.$inferInsert), userId })));
    },
  };
}

function parseLinks(v: string): { url: string; name: string }[] {
  return v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf("|");
      const [name, url] = i >= 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ["", l];
      return { name, url: /^https?:\/\//i.test(url) ? url : `https://${url}` };
    });
}

async function planReminders(db: DB, userId: string, rows: Row[], result: ImportResult): Promise<Plan> {
  const [existing, staff] = await Promise.all([db.select().from(reports).where(eq(reports.userId, userId)), staffNames(db, userId)]);
  const updates = new Map<string, { set: Record<string, unknown>; before: typeof reports.$inferSelect }>();
  const inserts: { name: string; values: Record<string, unknown> }[] = [];

  for (const row of rows) {
    const c = row.cells;
    const id = (c.get("id") ?? "").trim();
    const name = lower(c.get("name") ?? "");
    const match = existing.find((r) => r.id === id) ?? (name ? existing.find((r) => lower(r.name) === name) : undefined);
    const pendingInsert = !match && name ? inserts.find((i) => i.name === name) : undefined;
    const v: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const k of ["name", "notes"]) if (c.has(k)) v[k] = c.get(k)!;
    for (const [k, h] of [["startDate", "Date"], ["endDate", "End repeat"]] as const) {
      const err = setDay(row, k, h, v);
      if (err) errors.push(err);
    }
    if (c.has("startDate") && v.startDate === null) delete v.startDate;
    if (c.has("dueTime")) {
      const tm = parseTime(c.get("dueTime")!);
      if (tm === undefined) errors.push(`Time: "${c.get("dueTime")}" is not a time (use 10:30)`);
      else v.dueTime = tm;
    }
    if (c.has("repeat") && c.get("repeat")) {
      const k = normHeader(c.get("repeat")!);
      const rep = REPEATS.find((x) => normHeader(x) === k || normHeader(REPEAT_LABEL[x]) === k);
      if (!rep) errors.push(`Repeat: "${c.get("repeat")}" should be one of ${REPEATS.map((x) => REPEAT_LABEL[x]).join(", ")}`);
      else v.repeat = rep;
    }
    if (c.has("leadDays")) {
      const n = num(c.get("leadDays")!, true);
      if (n === undefined) errors.push(`Remind me: "${c.get("leadDays")}" is not a whole number of days`);
      else v.leadDays = n ?? 0;
    }
    if (c.has("priority")) {
      const p = parsePriority(c.get("priority")!);
      if (p === undefined) errors.push(`Priority: "${c.get("priority")}" should be Urgent, High, Medium or Low`);
      else if (p) v.priority = p;
    }
    if (c.has("active")) {
      const a = parseYesNo(c.get("active")!);
      if (a === undefined) errors.push(`Active: "${c.get("active")}" should be Yes or No`);
      else if (a !== null) v.active = a;
    }
    if (c.has("links")) {
      const l = reminderLinks.safeParse(parseLinks(c.get("links")!));
      if (!l.success) errors.push(`Links: ${l.error.issues[0]?.message ?? "not valid"}`);
      else v.links = l.data;
    }
    if (c.has("for")) {
      const f = parseFor(staff, c.get("for")!);
      if (typeof f === "string") errors.push(f);
      else Object.assign(v, f);
    }
    if (errors.length) {
      problem(result, row, errors.join("; "));
      continue;
    }
    if (match) {
      const parsed = reportPatch.safeParse(v);
      if (!parsed.success) {
        problem(result, row, zodMessage(parsed.error));
        continue;
      }
      if (!updates.has(match.id)) result.updated++;
      updates.set(match.id, { set: { ...(updates.get(match.id)?.set ?? {}), ...parsed.data }, before: match });
      continue;
    }
    const parsed = reportInput.safeParse(pendingInsert ? { ...pendingInsert.values, ...v } : v);
    if (!parsed.success) {
      problem(result, row, zodMessage(parsed.error).replace("startDate", "Date"));
      continue;
    }
    if (pendingInsert) pendingInsert.values = parsed.data;
    else {
      inserts.push({ name: lower(parsed.data.name), values: parsed.data });
      result.added++;
    }
  }
  const dueDay = (d: string) => Number(d.slice(8, 10));
  return {
    result,
    write: async () => {
      for (const [id, { set, before }] of updates) {
        await db.update(reports).set({ ...set, ...(typeof set.startDate === "string" ? { dueDay: dueDay(set.startDate) } : {}), updatedAt: new Date() }).where(eq(reports.id, id));
        // Its open tasks follow a change of what it is about, as in the reminder form.
        if ("relatedKind" in set && (set.relatedKind !== before.relatedKind || set.relatedId !== before.relatedId)) {
          const periodIds = (await db.select({ id: reportPeriods.id }).from(reportPeriods).where(eq(reportPeriods.reportId, id))).map((p) => p.id);
          if (periodIds.length) await db.update(tasks).set({ relatedKind: set.relatedKind as never, relatedId: (set.relatedId as string | null) ?? null }).where(and(inArray(tasks.reportPeriodId, periodIds), eq(tasks.status, "open")));
        }
      }
      if (inserts.length) {
        await db.insert(reports).values(inserts.map((i) => {
          const r = i.values as ReturnType<typeof reportInput.parse>;
          return { ...r, userId, dueDay: dueDay(r.startDate) };
        }));
      }
    },
  };
}

const PLANNERS: Record<CsvKind, (db: DB, userId: string, rows: Row[], result: ImportResult) => Promise<Plan>> = {
  files: planFiles,
  employees: planEmployees,
  tasks: planTasks,
  reminders: planReminders,
};

// --- Master backup ---

type TableInfo = { table: PgTable & { id: never; userId: never }; refs?: Record<string, { table: PgTable; required?: boolean }> };
const BACKUP: Record<BackupTable, TableInfo> = {
  designations: { table: designations as never },
  employeeTypes: { table: employeeTypes as never },
  employees: { table: employees as never, refs: { designationId: { table: designations }, typeId: { table: employeeTypes } } },
  officeFiles: { table: officeFiles as never },
  reports: { table: reports as never },
  reportPeriods: { table: reportPeriods as never, refs: { reportId: { table: reports, required: true } } },
  tasks: { table: tasks as never, refs: { threadId: { table: emailThreads }, reportPeriodId: { table: reportPeriods } } },
  events: { table: events as never },
  hiddenSnippets: { table: hiddenSnippets as never },
  mutedSenders: { table: mutedSenders as never },
};
type AnyTable = PgTable & { id: PgColumn; userId: PgColumn };

// Turns a backup row back into one for this user: known columns only, times as dates, and links to rows that
// aren't here (an email from another Gmail account, say) dropped.
async function restoreRows(db: DB, userId: string, info: TableInfo, rows: Record<string, unknown>[]) {
  const cols = getTableColumns(info.table);
  const clean = rows
    .filter((r) => r && typeof r === "object" && typeof r.id === "string")
    .map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, col] of Object.entries(cols)) {
        if (k === "userId" || !(k in r)) continue;
        const v = r[k];
        out[k] = col.columnType === "PgTimestamp" && typeof v === "string" ? new Date(v) : v;
      }
      out.userId = userId;
      return out;
    });
  for (const [col, ref] of Object.entries(info.refs ?? {})) {
    const want = [...new Set(clean.map((r) => r[col]).filter((x): x is string => typeof x === "string"))];
    const t = ref.table as AnyTable;
    const have = want.length ? new Set((await db.select({ id: t.id }).from(t as PgTable).where(and(eq(t.userId, userId), inArray(t.id, want)))).map((x) => x.id as string)) : new Set<string>();
    for (const r of clean) if (typeof r[col] === "string" && !have.has(r[col] as string)) r[col] = ref.required ? undefined : null;
  }
  return clean.filter((r) => !Object.entries(info.refs ?? {}).some(([col, ref]) => ref.required && r[col] === undefined));
}

export const transferRoutes = new Hono<AppEnv>()
  .get("/backup", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const tables: Record<string, unknown[]> = {};
    for (const name of BACKUP_TABLES) {
      const t = BACKUP[name].table as AnyTable;
      const rows = (await db.select().from(t as PgTable).where(eq(t.userId, userId))) as Record<string, unknown>[];
      tables[name] = rows.map(({ userId: _u, ...rest }) => rest);
    }
    await log(db, userId, "data.backup_exported", "Backup downloaded");
    return c.json({ app: "WorkDesk", version: 1, exportedAt: new Date().toISOString(), tables });
  })
  // One table's rows (up to a few hundred) of a backup; rows already here (same id) are left as they are.
  .post("/backup", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { table, rows } = (await c.req.json()) as { table: BackupTable; rows: Record<string, unknown>[] };
    const info = BACKUP[table];
    if (!info || !Array.isArray(rows) || rows.length > 1000) throw new HTTPException(400, { message: "Not a WorkDesk backup" });
    const clean = await restoreRows(db, userId, info, rows);
    if (!clean.length) return c.json({ added: 0 });
    const t = info.table as AnyTable;
    try {
      const added = await db.insert(t as PgTable).values(clean as never).onConflictDoNothing().returning({ id: t.id });
      return c.json({ added: added.length });
    } catch (e) {
      throw new HTTPException(400, { message: `${table}: ${(e as Error).message.split("\n")[0]}` });
    }
  })
  .post("/backup/done", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { added } = (await c.req.json()) as { added: Record<string, number> };
    const total = Object.values(added ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
    await log(db, userId, "data.backup_imported", `Backup imported: ${total} item${total === 1 ? "" : "s"} added`);
    return c.json({ ok: true });
  })

  .get("/:kind/csv", async (c) => {
    const kind = c.req.param("kind");
    if (!isKind(kind)) throw new HTTPException(404, { message: "Unknown list" });
    const db = c.get("db");
    const userId = c.get("userId");
    const rows = await exportRows(db, userId, kind, timezone(c.env));
    await log(db, userId, `data.${kind}_exported`, `${CSV_TITLES[kind]} exported (${rows.length} row${rows.length === 1 ? "" : "s"})`);
    return c.body(toCsv([CSV_COLUMNS[kind].map((col) => col.header), ...rows]), 200, { "content-type": "text/csv; charset=utf-8" });
  })
  // dryRun: what would happen (sent with the whole file first, for the preview); then the rows are sent again in
  // small parts to be saved. firstLine: the file line of rows[0].
  .post("/:kind/import", async (c) => {
    const kind = c.req.param("kind");
    if (!isKind(kind)) throw new HTTPException(404, { message: "Unknown list" });
    const db = c.get("db");
    const userId = c.get("userId");
    const body = (await c.req.json()) as { headers: string[]; rows: unknown[][]; firstLine?: number; dryRun?: boolean };
    if (!Array.isArray(body.headers) || !Array.isArray(body.rows) || body.rows.length > MAX_IMPORT_ROWS) throw new HTTPException(400, { message: `Send up to ${MAX_IMPORT_ROWS} rows at a time` });
    const { keys, unknown } = mapHeaders(kind, body.headers.map(String));
    const missing = CSV_COLUMNS[kind].filter((col) => col.required && !keys.includes(col.key));
    if (missing.length && !body.rows.length) throw new HTTPException(400, { message: `The file has no ${missing.map((m) => m.header).join(", ")} column` });
    const exportOnly = new Set(CSV_COLUMNS[kind].filter((col) => col.exportOnly).map((col) => col.key));
    const first = body.firstLine ?? 2;
    const rows: Row[] = body.rows
      .map((r, i) => {
        const cells = new Map<string, string>();
        keys.forEach((k, j) => k && !exportOnly.has(k) && cells.set(k, cleanCell(r[j])));
        return { line: first + i, cells, empty: (r ?? []).every((x) => !cleanCell(x)) };
      })
      .filter((r) => !r.empty);
    const result: ImportResult = { added: 0, updated: 0, skipped: 0, problems: [], created: [], unknownColumns: unknown };
    if (missing.length) {
      result.problems.push({ row: 1, message: `The file has no ${missing.map((m) => m.header).join(", ")} column, so new ${CSV_TITLES[kind].toLowerCase()} can't be added` });
    }
    const plan = await PLANNERS[kind](db, userId, rows, result);
    if (!body.dryRun && (result.added || result.updated)) {
      await plan.write();
      if (kind === "reminders") await ensureReportPeriods(db, todayIn(timezone(c.env)), userId);
      if (kind === "employees") {
        await ensurePensionTasks(db, todayIn(timezone(c.env)), userId);
        await ensureContractTasks(db, todayIn(timezone(c.env)), userId);
      }
      await log(db, userId, `data.${kind}_imported`, `${CSV_TITLES[kind]} imported: ${result.added} added, ${result.updated} updated`);
    }
    return c.json(result);
  });
