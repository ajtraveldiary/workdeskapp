// Staff page (user request 2026-10-07): the office's designations and employees, and the open work linked to
// an employee. Only WorkDesk's database changes; every change is in History.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, eq, inArray, max, or, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { designations, employeeTypes, employees, events, reports, tasks } from "../db/schema";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";
import { designationInput, employeeInput } from "../../shared/schemas";
import { COMMON_DESIGNATIONS, COMMON_EMPLOYEE_TYPES, nextYear, renewedEnd, retiringSoon } from "../../shared/staff";
import type { Employee, RetiringEmployee, StaffList } from "../../shared/types";
import { openTaskOrder, selectTasks, toTask } from "./tasks";
import { ensurePensionTasks } from "../lib/pension";
import { ensureContractTasks } from "../lib/contracts";
import { ensureProbationTasks } from "../lib/probation";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });

// A temporary employee keeps only name, designation, engagement, type, phone, email, category, date of birth,
// date of joining, contract days, pay per day and contract end date (user request 2026-10-07); a permanent one
// has none of the temporary details.
export function employeeValues(input: ReturnType<typeof employeeInput.parse>) {
  return input.permanent
    ? { ...input, engagedTill: null, engagement: "", typeId: null, contractDays: null, payPerDay: null }
    : { ...input, pen: "", joinedOfficeOn: null, nextIncrementOn: null, retiresOn: null, probationDeclaredOn: null, payScale: "", address: "", notes: "" };
}

function toEmployee(e: typeof employees.$inferSelect): Employee {
  const { userId: _u, createdAt: _c, updatedAt: _up, ...rest } = e;
  return rest;
}

// The employee's "Contract ends" or "Probation declaration" task (user request 2026-10-08) is completed by
// Renew / Contract ended / Probation declared and reopened by their Undo, with the same History entries as
// ticking a task.
async function setContractTask(db: DB, userId: string, taskId: string | null, done: boolean) {
  if (!taskId) return;
  const [t] = await db
    .update(tasks)
    .set(done ? { status: "done", completedAt: new Date(), waitingSince: null, replyBy: null, updatedAt: new Date() } : { status: "open", completedAt: null, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), eq(tasks.status, done ? "open" : "done")))
    .returning({ id: tasks.id, title: tasks.title });
  if (t) await db.insert(events).values({ userId, entityType: "task", entityId: t.id, action: done ? "task.completed" : "task.reopened", summary: done ? "Completed" : "Reopened", detail: { title: t.title } });
}

async function loadEmployee(db: DB, userId: string, id: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.userId, userId)));
  if (!e) throw new HTTPException(404, { message: "Employee not found" });
  return e;
}
async function loadDesignation(db: DB, userId: string, id: string) {
  const [d] = await db.select().from(designations).where(and(eq(designations.id, id), eq(designations.userId, userId)));
  if (!d) throw new HTTPException(404, { message: "Designation not found" });
  return d;
}
async function checkDesignation(db: DB, userId: string, id: string | null) {
  if (id) await loadDesignation(db, userId, id);
}
async function loadType(db: DB, userId: string, id: string) {
  const [t] = await db.select().from(employeeTypes).where(and(eq(employeeTypes.id, id), eq(employeeTypes.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Type not found" });
  return t;
}

// Tasks and reminders that say they are about this employee / designation.
async function linkCount(db: DB, kind: "employee" | "designation", id: string) {
  const [t] = await db.select({ n: count() }).from(tasks).where(and(eq(tasks.relatedKind, kind), eq(tasks.relatedId, id)));
  const [r] = await db.select({ n: count() }).from(reports).where(and(eq(reports.relatedKind, kind), eq(reports.relatedId, id)));
  return Number(t?.n ?? 0) + Number(r?.n ?? 0);
}

export const staffRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [d, t, e] = await Promise.all([
      db.select({ id: designations.id, name: designations.name, sortOrder: designations.sortOrder }).from(designations).where(eq(designations.userId, userId)).orderBy(asc(designations.sortOrder), asc(designations.name)),
      db.select({ id: employeeTypes.id, name: employeeTypes.name, sortOrder: employeeTypes.sortOrder }).from(employeeTypes).where(eq(employeeTypes.userId, userId)).orderBy(asc(employeeTypes.sortOrder), asc(employeeTypes.name)),
      db.select().from(employees).where(eq(employees.userId, userId)).orderBy(asc(employees.name)),
    ]);
    return c.json({ designations: d, types: t, employees: e.map(toEmployee) } satisfies StaffList);
  })

  // --- Designations ---
  .post("/designations", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { name } = designationInput.parse(await c.req.json());
    const [m] = await db.select({ m: max(designations.sortOrder) }).from(designations).where(eq(designations.userId, userId));
    const [d] = await db.insert(designations).values({ userId, name, sortOrder: (m?.m ?? 0) + 1 }).returning();
    await log(db, userId, "staff.designation_added", `Designation added: ${name}`);
    return c.json(d, 201);
  })
  // The common Health Services list; ones already there (same name) are skipped.
  .post("/designations/common", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const have = await db.select({ name: designations.name, sortOrder: designations.sortOrder }).from(designations).where(eq(designations.userId, userId));
    const names = new Set(have.map((d) => d.name.trim().toLowerCase()));
    const start = Math.max(0, ...have.map((d) => d.sortOrder)) + 1;
    const add = COMMON_DESIGNATIONS.filter((n) => !names.has(n.toLowerCase()));
    if (add.length) {
      await db.insert(designations).values(add.map((name, i) => ({ userId, name, sortOrder: start + i })));
      await log(db, userId, "staff.designations_common", `Added ${add.length} common designations`);
    }
    return c.json({ added: add.length });
  })
  .patch("/designations/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const d = await loadDesignation(db, userId, c.req.param("id"));
    const { name } = designationInput.parse(await c.req.json());
    await db.update(designations).set({ name }).where(eq(designations.id, d.id));
    if (name !== d.name) await log(db, userId, "staff.designation_renamed", `Designation renamed: ${d.name} → ${name}`);
    return c.json({ ok: true });
  })
  // Moves a designation one place up or down the list.
  .post("/designations/:id/move", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { by } = (await c.req.json()) as { by: number };
    const list = await db.select().from(designations).where(eq(designations.userId, userId)).orderBy(asc(designations.sortOrder), asc(designations.name));
    const i = list.findIndex((d) => d.id === c.req.param("id"));
    const j = i + (by < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return c.json({ ok: true });
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (const [k, d] of list.entries()) if (d.sortOrder !== k) await db.update(designations).set({ sortOrder: k }).where(eq(designations.id, d.id));
    return c.json({ ok: true });
  })
  // Only an unused designation can be removed: no employees and no tasks or reminders about it.
  .delete("/designations/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const d = await loadDesignation(db, userId, c.req.param("id"));
    const [e] = await db.select({ n: count() }).from(employees).where(eq(employees.designationId, d.id));
    if (Number(e?.n ?? 0) > 0) throw new HTTPException(409, { message: `${d.name} has ${e!.n} employee${Number(e!.n) === 1 ? "" : "s"}. Change their designation first.` });
    const links = await linkCount(db, "designation", d.id);
    if (links > 0) throw new HTTPException(409, { message: `${d.name} is linked to ${links} task${links === 1 ? "" : "s"} or reminder${links === 1 ? "" : "s"}, so it can't be removed. Rename it instead.` });
    await db.delete(designations).where(eq(designations.id, d.id));
    await log(db, userId, "staff.designation_removed", `Designation removed: ${d.name}`);
    return c.json({ ok: true });
  })

  // --- Types of temporary employees (user request 2026-10-07): HMC, NHM… ---
  .post("/types", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { name } = designationInput.parse(await c.req.json());
    const [m] = await db.select({ m: max(employeeTypes.sortOrder) }).from(employeeTypes).where(eq(employeeTypes.userId, userId));
    const [t] = await db.insert(employeeTypes).values({ userId, name, sortOrder: (m?.m ?? 0) + 1 }).returning();
    await log(db, userId, "staff.type_added", `Employee type added: ${name}`);
    return c.json(t, 201);
  })
  .post("/types/common", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const have = await db.select({ name: employeeTypes.name, sortOrder: employeeTypes.sortOrder }).from(employeeTypes).where(eq(employeeTypes.userId, userId));
    const names = new Set(have.map((t) => t.name.trim().toLowerCase()));
    const start = Math.max(0, ...have.map((t) => t.sortOrder)) + 1;
    const add = COMMON_EMPLOYEE_TYPES.filter((n) => !names.has(n.toLowerCase()));
    if (add.length) {
      await db.insert(employeeTypes).values(add.map((name, i) => ({ userId, name, sortOrder: start + i })));
      await log(db, userId, "staff.types_common", `Added ${add.length} employee types`);
    }
    return c.json({ added: add.length });
  })
  .patch("/types/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadType(db, userId, c.req.param("id"));
    const { name } = designationInput.parse(await c.req.json());
    await db.update(employeeTypes).set({ name }).where(eq(employeeTypes.id, t.id));
    if (name !== t.name) await log(db, userId, "staff.type_renamed", `Employee type renamed: ${t.name} → ${name}`);
    return c.json({ ok: true });
  })
  .post("/types/:id/move", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { by } = (await c.req.json()) as { by: number };
    const list = await db.select().from(employeeTypes).where(eq(employeeTypes.userId, userId)).orderBy(asc(employeeTypes.sortOrder), asc(employeeTypes.name));
    const i = list.findIndex((t) => t.id === c.req.param("id"));
    const j = i + (by < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return c.json({ ok: true });
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (const [k, t] of list.entries()) if (t.sortOrder !== k) await db.update(employeeTypes).set({ sortOrder: k }).where(eq(employeeTypes.id, t.id));
    return c.json({ ok: true });
  })
  // Only a type no employee has can be removed.
  .delete("/types/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadType(db, userId, c.req.param("id"));
    const [e] = await db.select({ n: count() }).from(employees).where(eq(employees.typeId, t.id));
    if (Number(e?.n ?? 0) > 0) throw new HTTPException(409, { message: `${t.name} has ${e!.n} employee${Number(e!.n) === 1 ? "" : "s"}. Change their type first, or rename it.` });
    await db.delete(employeeTypes).where(eq(employeeTypes.id, t.id));
    await log(db, userId, "staff.type_removed", `Employee type removed: ${t.name}`);
    return c.json({ ok: true });
  })

  // --- Employees ---
  .post("/employees", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = employeeInput.parse(await c.req.json());
    await checkDesignation(db, userId, input.designationId);
    if (!input.permanent && input.typeId) await loadType(db, userId, input.typeId);
    const [e] = await db.insert(employees).values({ ...employeeValues(input), userId }).returning();
    await log(db, userId, "staff.employee_added", `Employee added: ${e!.name}`);
    // Retiring within 12 months: their Pension papers task straight away (user request 2026-10-08); a contract
    // ending within 7 days: its Contract ends task; 2 years of service near: its Probation declaration task.
    await ensurePensionTasks(db, todayIn(timezone(c.env)), userId);
    await ensureContractTasks(db, todayIn(timezone(c.env)), userId);
    await ensureProbationTasks(db, todayIn(timezone(c.env)), userId);
    return c.json(toEmployee(e!), 201);
  })
  // The form sends every detail.
  .put("/employees/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const input = employeeInput.parse(await c.req.json());
    await checkDesignation(db, userId, input.designationId);
    if (!input.permanent && input.typeId) await loadType(db, userId, input.typeId);
    await db.update(employees).set({ ...employeeValues(input), updatedAt: new Date() }).where(eq(employees.id, e.id));
    await log(db, userId, "staff.employee_changed", `Employee details changed: ${input.name}`);
    await ensurePensionTasks(db, todayIn(timezone(c.env)), userId);
    await ensureContractTasks(db, todayIn(timezone(c.env)), userId);
    await ensureProbationTasks(db, todayIn(timezone(c.env)), userId);
    return c.json({ ok: true });
  })
  // Left the office (transfer, retirement…) or back again.
  .post("/employees/:id/left", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const { left } = (await c.req.json()) as { left: boolean };
    const leftOn = left ? todayIn(timezone(c.env)) : null;
    await db.update(employees).set({ leftOn, updatedAt: new Date() }).where(eq(employees.id, e.id));
    await log(db, userId, left ? "staff.employee_left" : "staff.employee_back", left ? `${e.name} left the office` : `${e.name} is back in the office`);
    return c.json({ ok: true });
  })
  // Increment done (user request 2026-10-07): the next increment date moves a year on. Undo sends the date it
  // was ("undoTo"), which is put back only if nothing changed it since.
  .post("/employees/:id/increment", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const { undoTo } = (await c.req.json().catch(() => ({}))) as { undoTo?: string };
    if (undoTo !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(undoTo)) throw new HTTPException(400, { message: "Use YYYY-MM-DD" });
      if (e.nextIncrementOn !== nextYear(undoTo)) return c.json({ previous: e.nextIncrementOn, next: e.nextIncrementOn });
      await db.update(employees).set({ nextIncrementOn: undoTo, updatedAt: new Date() }).where(eq(employees.id, e.id));
      await log(db, userId, "staff.increment_undone", `Increment for ${e.name} not done after all; due ${undoTo} again`);
      return c.json({ previous: e.nextIncrementOn, next: undoTo });
    }
    if (!e.nextIncrementOn) throw new HTTPException(400, { message: `${e.name} has no increment date` });
    const next = nextYear(e.nextIncrementOn);
    await db.update(employees).set({ nextIncrementOn: next, updatedAt: new Date() }).where(eq(employees.id, e.id));
    await log(db, userId, "staff.increment_done", `Increment for ${e.name} (due ${e.nextIncrementOn}) marked done; next due ${next}`);
    return c.json({ previous: e.nextIncrementOn, next });
  })
  // Contract ending (user request 2026-10-08), from ticking its "Contract ends" task, which both complete. Renew: the contract runs the same number
  // of days again from the day after it ends. Undo sends the end date it was ("undoTo"), put back only if
  // nothing changed it since.
  .post("/employees/:id/contract/renew", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const { undoTo } = (await c.req.json().catch(() => ({}))) as { undoTo?: string };
    if (e.permanent) throw new HTTPException(400, { message: `${e.name} is a permanent employee` });
    if (!e.contractDays) throw new HTTPException(400, { message: `Set ${e.name}'s contract period (days) first` });
    if (undoTo !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(undoTo)) throw new HTTPException(400, { message: "Use YYYY-MM-DD" });
      if (e.engagedTill !== renewedEnd(undoTo, e.contractDays)) return c.json({ previous: e.engagedTill, next: e.engagedTill });
      await db.update(employees).set({ engagedTill: undoTo, updatedAt: new Date() }).where(eq(employees.id, e.id));
      await log(db, userId, "staff.contract_renew_undone", `Contract of ${e.name} not renewed after all; ends ${undoTo} again`);
      if (e.contractTaskFor === undoTo) await setContractTask(db, userId, e.contractTaskId, false);
      return c.json({ previous: e.engagedTill, next: undoTo });
    }
    if (!e.engagedTill) throw new HTTPException(400, { message: `${e.name} has no contract end date` });
    const next = renewedEnd(e.engagedTill, e.contractDays);
    await db.update(employees).set({ engagedTill: next, updatedAt: new Date() }).where(eq(employees.id, e.id));
    await log(db, userId, "staff.contract_renewed", `Contract of ${e.name} (ended ${e.engagedTill}) renewed for ${e.contractDays} days; now ends ${next}`);
    if (e.contractTaskFor === e.engagedTill) await setContractTask(db, userId, e.contractTaskId, true);
    return c.json({ previous: e.engagedTill, next });
  })
  // Contract ended: the employee left the office on the contract's end date. Undo ({ undo: true }) brings them
  // back, only if they are still marked as left on that date.
  .post("/employees/:id/contract/ended", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const { undo } = (await c.req.json().catch(() => ({}))) as { undo?: boolean };
    if (e.permanent) throw new HTTPException(400, { message: `${e.name} is a permanent employee` });
    if (!e.engagedTill) throw new HTTPException(400, { message: `${e.name} has no contract end date` });
    if (undo) {
      if (e.leftOn !== e.engagedTill) return c.json({ leftOn: e.leftOn });
      await db.update(employees).set({ leftOn: null, updatedAt: new Date() }).where(eq(employees.id, e.id));
      await log(db, userId, "staff.contract_end_undone", `Contract of ${e.name} not ended after all; back in the office`);
      if (e.contractTaskFor === e.engagedTill) await setContractTask(db, userId, e.contractTaskId, false);
      return c.json({ leftOn: null });
    }
    await db.update(employees).set({ leftOn: e.engagedTill, updatedAt: new Date() }).where(eq(employees.id, e.id));
    await log(db, userId, "staff.contract_ended", `Contract of ${e.name} ended on ${e.engagedTill}; left the office`);
    if (e.contractTaskFor === e.engagedTill) await setContractTask(db, userId, e.contractTaskId, true);
    return c.json({ leftOn: e.engagedTill });
  })
  // Probation declared (user request 2026-10-08), from ticking the employee's "Probation declaration" task:
  // records today as the declared date and completes the task. Undo ({ undo: true }) clears the date (only if
  // it is still the one recorded, sent as "declaredOn") and reopens the task.
  .post("/employees/:id/probation", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const { undo, declaredOn } = (await c.req.json().catch(() => ({}))) as { undo?: boolean; declaredOn?: string };
    if (!e.permanent) throw new HTTPException(400, { message: `${e.name} is a temporary employee` });
    if (undo) {
      if (!declaredOn || e.probationDeclaredOn !== declaredOn) return c.json({ declaredOn: e.probationDeclaredOn });
      await db.update(employees).set({ probationDeclaredOn: null, updatedAt: new Date() }).where(eq(employees.id, e.id));
      await log(db, userId, "staff.probation_undone", `Probation of ${e.name} not declared after all`);
      await setContractTask(db, userId, e.probationTaskId, false);
      return c.json({ declaredOn: null });
    }
    const today = todayIn(timezone(c.env));
    await db.update(employees).set({ probationDeclaredOn: today, updatedAt: new Date() }).where(eq(employees.id, e.id));
    await log(db, userId, "staff.probation_declared", `Probation of ${e.name} declared on ${today}`);
    await setContractTask(db, userId, e.probationTaskId, true);
    return c.json({ declaredOn: today });
  })
  // Retiring within 12 months (user request 2026-10-08): permanent employees still in the office whose
  // retirement date is within a year (or already past), soonest first, each with their Pension papers task.
  .get("/retiring", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const today = todayIn(timezone(c.env));
    const people = (
      await db
        .select({ employeeId: employees.id, name: employees.name, designation: designations.name, retiresOn: employees.retiresOn, pensionTaskId: employees.pensionTaskId })
        .from(employees)
        .leftJoin(designations, eq(employees.designationId, designations.id))
        .where(and(eq(employees.userId, userId), eq(employees.permanent, true), sql`${employees.leftOn} is null`, sql`${employees.retiresOn} is not null`))
        .orderBy(asc(employees.retiresOn), asc(employees.name))
    ).filter((e) => retiringSoon(e.retiresOn, today));
    const ids = people.map((p) => p.pensionTaskId).filter((x): x is string => !!x);
    const found = ids.length ? (await selectTasks(db).where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)))).map(toTask) : [];
    const byId = new Map(found.map((t) => [t.id, t]));
    const retiring: RetiringEmployee[] = people.map(({ pensionTaskId, ...p }) => ({ ...p, retiresOn: p.retiresOn!, task: (pensionTaskId && byId.get(pensionTaskId)) || null }));
    return c.json({ today, retiring });
  })
  // Only an employee no task or reminder is about can be deleted; otherwise "Left the office" keeps the name.
  .delete("/employees/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const links = await linkCount(db, "employee", e.id);
    if (links > 0) throw new HTTPException(409, { message: `${e.name} is linked to ${links} task${links === 1 ? "" : "s"} or reminder${links === 1 ? "" : "s"}. Use "Left the office" instead.` });
    await db.delete(employees).where(eq(employees.id, e.id));
    await log(db, userId, "staff.employee_removed", `Employee removed: ${e.name}`);
    return c.json({ ok: true });
  })
  // Open tasks and active reminders about this employee, or about their designation.
  .get("/employees/:id/work", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("id"));
    const today = todayIn(timezone(c.env));
    const about = (t: typeof tasks | typeof reports) =>
      or(and(eq(t.relatedKind, "employee"), eq(t.relatedId, e.id)), e.designationId ? and(eq(t.relatedKind, "designation"), eq(t.relatedId, e.designationId)) : sql`false`);
    const [open, rems] = await Promise.all([
      selectTasks(db)
        .where(and(eq(tasks.userId, userId), eq(tasks.status, "open"), about(tasks)))
        .orderBy(...openTaskOrder)
        .limit(100),
      db.select({ id: reports.id, name: reports.name, active: reports.active, relatedKind: reports.relatedKind }).from(reports).where(and(eq(reports.userId, userId), about(reports))).orderBy(asc(reports.name)),
    ]);
    return c.json({ tasks: open.map(toTask), reminders: rems, today });
  });
