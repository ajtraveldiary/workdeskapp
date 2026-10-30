// Leave (user request 2026-10-30, plan in docs/LEAVE_PLAN.md). Phase 1: the leave types of Settings › Leave and each
// permanent employee's leave account: opening balances, credits and adjustments by hand, and "Credit now" for
// everyone. Phase 2: marking a leave (its account line and its task with the gazetted / non-gazetted steps),
// editing it, rejoining (curtailed early) and cancelling it. The account is never rewritten (lines are only
// added; a changed or cancelled leave gives its days back with a "cancel" line); every change is in History,
// naming the employee so it shows on their page.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, max, ne, or, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { employeeLeaves, employees, events, leaveLedger, leaveTypes, tasks } from "../db/schema";
import { leaveCreditInput, leaveInput, leaveLineInput, leavePatch, leaveSurrenderInput, leaveTypeInput, orderInput, postponeUndoInput } from "../../shared/schemas";
import { LEDGER_LABEL, SURRENDER_STEPS, daysWord, ksrType, formatDays, leaveEnd, leaveShort, leaveSteps, leaveTitle, postponeDays, rejoinDay, shiftDate, surrenderTitle } from "../../shared/leave";
import { dayLabel } from "../../shared/reminderSchedule";
import type { EmployeeLeave, LeaveAccount, LeaveCreditPlan, LeavePostponed, LeaveType, Task } from "../../shared/types";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";
import { ensureKsrLeaveTypes, ensureLeaveCredits, ksrValues, lapseAbove, settleLeaveTask } from "../lib/leave";
import { saveOrder } from "./staff";
import { selectTasks, toTask } from "./tasks";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });
const lower = (s: string) => s.trim().toLowerCase();

async function loadType(db: DB, userId: string, id: string) {
  const [t] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, id), eq(leaveTypes.userId, userId)));
  if (!t) throw new HTTPException(404, { message: "Leave type not found" });
  return t;
}
async function loadEmployee(db: DB, userId: string, id: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.userId, userId)));
  if (!e) throw new HTTPException(404, { message: "Employee not found" });
  if (!e.permanent) throw new HTTPException(400, { message: `${e.name} is a temporary employee; leave accounts are kept for permanent staff` });
  return e;
}

// A type keeps its own balance, or takes from another type's (which must keep one), or has none.
// autoCredit (phase 3): automatic yearly credits from today on (kept when already on), or by hand only.
async function checkedType(db: DB, userId: string, raw: unknown, today: string, self?: typeof leaveTypes.$inferSelect) {
  const { autoCredit, ...v } = leaveTypeInput.parse(raw);
  const same = await db.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.userId, userId), sql`lower(${leaveTypes.name}) = ${lower(v.name)}`));
  if (same.some((x) => x.id !== self?.id)) throw new HTTPException(409, { message: `There is already a leave type called ${v.name}` });
  if (v.drawsOnId) {
    if (v.drawsOnId === self?.id) throw new HTTPException(400, { message: "A leave type can't take from its own balance" });
    const other = await loadType(db, userId, v.drawsOnId);
    if (!other.hasAccount) throw new HTTPException(400, { message: `${other.name} keeps no balance of its own to take from` });
  }
  const hasAccount = v.drawsOnId ? false : v.hasAccount;
  const creditsFrom = autoCredit && hasAccount && (v.fromDuty || v.yearlyDays != null) ? (self?.creditsFrom ?? today) : null;
  if (self && self.hasAccount && !hasAccount) {
    const [n] = await db.select({ n: count() }).from(leaveLedger).where(eq(leaveLedger.typeId, self.id));
    if (Number(n?.n ?? 0) > 0) throw new HTTPException(409, { message: `${self.name} has lines in leave accounts, so it keeps its own balance` });
  }
  if (self && !hasAccount) {
    const [d] = await db.select({ n: count() }).from(leaveTypes).where(eq(leaveTypes.drawsOnId, self.id));
    if (Number(d?.n ?? 0) > 0) throw new HTTPException(409, { message: `Other leave types take from ${self.name}, so it keeps its own balance` });
  }
  return hasAccount
    ? { ...v, hasAccount, drawsOnId: null, perDay: 1, mayGoNegative: v.mayGoNegative, creditsFrom }
    : {
        ...v,
        hasAccount,
        maxBalance: null,
        yearlyDays: null,
        fromDuty: false,
        mayGoNegative: v.drawsOnId ? v.mayGoNegative : false,
        perDay: v.drawsOnId ? v.perDay : 1,
        creditsFrom: null,
        surrenderPerYear: null,
        terminalSurrender: null,
      };
}

async function listTypes(db: DB, userId: string): Promise<LeaveType[]> {
  const typeRows = () => db.select().from(leaveTypes).where(eq(leaveTypes.userId, userId)).orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
  let found = await typeRows();
  // The built-in KSR types are put in the first time the list is read (and again if one is missing).
  if (await ensureKsrLeaveTypes(db, userId, found)) found = await typeRows();
  const [rows, used, marked] = await Promise.all([
    found,
    db.select({ typeId: leaveLedger.typeId, n: count() }).from(leaveLedger).where(eq(leaveLedger.userId, userId)).groupBy(leaveLedger.typeId),
    db.select({ typeId: employeeLeaves.typeId, n: count() }).from(employeeLeaves).where(eq(employeeLeaves.userId, userId)).groupBy(employeeLeaves.typeId),
  ]);
  const lines = new Map(used.map((u) => [u.typeId, Number(u.n)]));
  const leaves = new Map(marked.map((u) => [u.typeId, Number(u.n)]));
  return rows.map((t) => {
    const { userId: _u, createdAt: _c, ...rest } = t;
    return { ...rest, lines: lines.get(t.id) ?? 0, leaves: leaves.get(t.id) ?? 0 };
  });
}

export const leaveRoutes = new Hono<AppEnv>()
  // --- Leave types (Settings › Leave) ---
  .get("/types", async (c) => c.json({ types: await listTypes(c.get("db"), c.get("userId")) }))
  .post("/types", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = await checkedType(db, userId, await c.req.json(), todayIn(timezone(c.env)));
    const [m] = await db.select({ m: max(leaveTypes.sortOrder) }).from(leaveTypes).where(eq(leaveTypes.userId, userId));
    const [t] = await db.insert(leaveTypes).values({ ...v, userId, sortOrder: (m?.m ?? 0) + 1 }).returning({ id: leaveTypes.id });
    await log(db, userId, "staff.leave_type_added", `Leave type added: ${v.name}`);
    return c.json(t, 201);
  })
  // The KSR types (KSR_LEAVE_TYPES) that are missing; once used by "Add the usual leaves", now they are always there.
  .post("/types/usual", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const added = await ensureKsrLeaveTypes(db, userId);
    if (added) await log(db, userId, "staff.leave_types_usual", `Added ${added} KSR leave type${added === 1 ? "" : "s"}`);
    return c.json({ added });
  })
  // Reset to KSR: a built-in type's figures go back to the rule's (it stays switched on or off, and keeps its
  // automatic credits).
  .post("/types/:id/reset", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadType(db, userId, c.req.param("id"));
    const k = ksrType(t.ksrKey);
    if (!k) throw new HTTPException(400, { message: `${t.name} is the office's own leave type, not a KSR one` });
    const [from] = k.drawsOn ? await db.select().from(leaveTypes).where(and(eq(leaveTypes.userId, userId), eq(leaveTypes.ksrKey, k.drawsOn))) : [];
    const values = ksrValues(k, from?.id ?? null);
    const v = await checkedType(db, userId, { ...values, active: t.active, autoCredit: !!t.creditsFrom }, todayIn(timezone(c.env)), t);
    await db.update(leaveTypes).set(v).where(eq(leaveTypes.id, t.id));
    await log(db, userId, "staff.leave_type_reset", `Leave type reset to the KSR figures: ${k.name}`);
    return c.json({ ok: true });
  })
  // The form sends every field.
  .put("/types/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadType(db, userId, c.req.param("id"));
    const v = await checkedType(db, userId, await c.req.json(), todayIn(timezone(c.env)), t);
    await db.update(leaveTypes).set(v).where(eq(leaveTypes.id, t.id));
    await log(db, userId, "staff.leave_type_changed", t.name === v.name ? `Leave type changed: ${v.name}` : `Leave type changed: ${t.name} → ${v.name}`);
    if (!t.creditsFrom && v.creditsFrom) {
      await log(db, userId, "staff.leave_auto_on", `${v.name}: credited automatically on each service anniversary from ${dayLabel(v.creditsFrom)}`);
      // An anniversary today is credited straight away.
      await ensureLeaveCredits(db, todayIn(timezone(c.env)), userId);
    } else if (t.creditsFrom && !v.creditsFrom) await log(db, userId, "staff.leave_auto_off", `${v.name}: automatic credits switched off`);
    return c.json({ ok: true });
  })
  .post("/types/order", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { ids } = orderInput.parse(await c.req.json());
    if (await saveOrder(db, leaveTypes, userId, ids)) await log(db, userId, "staff.leave_types_ordered", "Leave types rearranged");
    return c.json({ ok: true });
  })
  // Only an unused type: no account lines, and no other type takes from it.
  .delete("/types/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadType(db, userId, c.req.param("id"));
    if (t.ksrKey) throw new HTTPException(409, { message: `${t.name} is a KSR leave type, so it can't be removed. Switch it off instead.` });
    const [n] = await db.select({ n: count() }).from(leaveLedger).where(eq(leaveLedger.typeId, t.id));
    if (Number(n?.n ?? 0) > 0) throw new HTTPException(409, { message: `${t.name} is used in leave accounts, so it can't be removed. Rename it instead.` });
    const [l] = await db.select({ n: count() }).from(employeeLeaves).where(eq(employeeLeaves.typeId, t.id));
    if (Number(l?.n ?? 0) > 0) throw new HTTPException(409, { message: `Leave has been marked as ${t.name}, so it can't be removed. Rename it instead.` });
    const [d] = await db.select({ n: count() }).from(leaveTypes).where(eq(leaveTypes.drawsOnId, t.id));
    if (Number(d?.n ?? 0) > 0) throw new HTTPException(409, { message: `Other leave types take from ${t.name}. Change them first.` });
    await db.delete(leaveTypes).where(eq(leaveTypes.id, t.id));
    await log(db, userId, "staff.leave_type_removed", `Leave type removed: ${t.name}`);
    return c.json({ ok: true });
  })
  // "Credit now": the year's credit (e.g. 20 days of HPL for 2027) to every permanent employee still in the office.
  // dryRun lists who gets it; anyone already credited for that year is skipped (never twice).
  .post("/types/:id/credit", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadType(db, userId, c.req.param("id"));
    if (!t.hasAccount) throw new HTTPException(400, { message: `${t.name} keeps no balance to credit` });
    const v = leaveCreditInput.parse(await c.req.json());
    const staff = await db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(and(eq(employees.userId, userId), eq(employees.permanent, true), isNull(employees.leftOn)))
      .orderBy(asc(employees.name));
    const had = staff.length
      ? new Set(
          (
            await db
              .select({ id: leaveLedger.employeeId })
              .from(leaveLedger)
              .where(and(eq(leaveLedger.typeId, t.id), eq(leaveLedger.creditFor, v.creditFor), inArray(leaveLedger.employeeId, staff.map((e) => e.id))))
          ).map((r) => r.id),
        )
      : new Set<string>();
    const plan: LeaveCreditPlan = { creditFor: v.creditFor, days: v.days, employees: staff.map((e) => ({ ...e, already: had.has(e.id) })) };
    if (v.dryRun) return c.json(plan);
    const give = plan.employees.filter((e) => !e.already);
    const note = v.note || `Yearly credit for ${v.creditFor}`;
    const added = give.length
      ? await db
          .insert(leaveLedger)
          .values(give.map((e) => ({ userId, employeeId: e.id, typeId: t.id, onDate: v.onDate, days: v.days, kind: "credit" as const, creditFor: v.creditFor, note })))
          .onConflictDoNothing()
          .returning({ employeeId: leaveLedger.employeeId })
      : [];
    const lapsed = await lapseAbove(db, userId, t, added.map((a) => a.employeeId), v.onDate);
    if (added.length)
      await log(
        db,
        userId,
        "staff.leave_credited",
        `Credited ${daysWord(v.days)} ${leaveShort(t)} for ${v.creditFor} to ${added.length} employee${added.length === 1 ? "" : "s"}${lapsed ? ` (${lapsed} above the most that can be kept)` : ""}`,
      );
    return c.json({ credited: added.length, skipped: plan.employees.length - give.length, lapsed });
  })

  // --- An employee's leave account ---
  .get("/accounts/:employeeId", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [e] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, c.req.param("employeeId")), eq(employees.userId, userId)));
    if (!e) throw new HTTPException(404, { message: "Employee not found" });
    const lines = await db
      .select({ id: leaveLedger.id, typeId: leaveLedger.typeId, onDate: leaveLedger.onDate, days: leaveLedger.days, kind: leaveLedger.kind, creditFor: leaveLedger.creditFor, note: leaveLedger.note, terminal: leaveLedger.terminal, createdAt: leaveLedger.createdAt })
      .from(leaveLedger)
      .where(eq(leaveLedger.employeeId, e.id))
      .orderBy(desc(leaveLedger.onDate), desc(leaveLedger.createdAt));
    const total = new Map<string, number>();
    for (const l of lines) total.set(l.typeId, (total.get(l.typeId) ?? 0) + l.days);
    const [types, used] = await Promise.all([
      db.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.userId, userId), eq(leaveTypes.hasAccount, true))).orderBy(asc(leaveTypes.sortOrder)),
      db
        .select({ typeId: employeeLeaves.typeId, days: sql<string>`sum(${employeeLeaves.days})`, nonMedical: sql<string>`coalesce(sum(${employeeLeaves.days}) filter (where not ${employeeLeaves.onMedical}), 0)` })
        .from(employeeLeaves)
        .where(and(eq(employeeLeaves.employeeId, e.id), eq(employeeLeaves.status, "active")))
        .groupBy(employeeLeaves.typeId),
    ]);
    const account: LeaveAccount = {
      balances: types.map((t) => ({ typeId: t.id, balance: Math.round((total.get(t.id) ?? 0) * 10) / 10 })),
      lines: lines.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
      used: used.map((u) => ({ typeId: u.typeId, days: Number(u.days), nonMedical: Number(u.nonMedical) })),
    };
    return c.json(account);
  })
  // Opening balance (from the service book; one per type), a credit, or an adjustment (+ or −).
  .post("/accounts/:employeeId/lines", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("employeeId"));
    const v = leaveLineInput.parse(await c.req.json());
    const t = await loadType(db, userId, v.typeId);
    if (!t.hasAccount) throw new HTTPException(400, { message: `${t.name} keeps no balance of its own` });
    if (v.kind === "opening") {
      const [o] = await db.select({ id: leaveLedger.id }).from(leaveLedger).where(and(eq(leaveLedger.employeeId, e.id), eq(leaveLedger.typeId, t.id), eq(leaveLedger.kind, "opening")));
      if (o) throw new HTTPException(409, { message: `${e.name} already has an opening balance of ${leaveShort(t)}. Add an adjustment to correct it.` });
    }
    const [line] = await db.insert(leaveLedger).values({ userId, employeeId: e.id, typeId: t.id, onDate: v.onDate, days: v.days, kind: v.kind, note: v.note }).returning({ id: leaveLedger.id });
    const lapsed = v.kind === "credit" ? await lapseAbove(db, userId, t, [e.id], v.onDate) : 0;
    const signed = v.kind === "opening" ? formatDays(v.days) : `${v.days > 0 ? "+" : ""}${formatDays(v.days)}`;
    await log(db, userId, `staff.leave_${v.kind}`, `Leave account of ${e.name}: ${LEDGER_LABEL[v.kind]} ${signed} ${leaveShort(t)}${v.note ? ` (${v.note})` : ""}${lapsed ? ", the extra above the most that can be kept lapsed" : ""}`);
    return c.json({ id: line!.id }, 201);
  })

  // --- Leaves marked (phase 2) ---
  // ?employeeId=… : that employee's leaves, newest first. Otherwise the leaves that matter now (Employees page):
  // not cancelled, not yet rejoined, ending from a month ago and starting within the next 30 days.
  .get("/leaves", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const employeeId = c.req.query("employeeId");
    const today = todayIn(timezone(c.env));
    const rows = await db
      .select()
      .from(employeeLeaves)
      .where(
        and(
          eq(employeeLeaves.userId, userId),
          employeeId
            ? eq(employeeLeaves.employeeId, employeeId)
            : and(eq(employeeLeaves.status, "active"), or(isNull(employeeLeaves.rejoinedOn), sql`${employeeLeaves.rejoinedOn} > ${today}`), gte(employeeLeaves.toDate, shiftDate(today, -31)), lte(employeeLeaves.fromDate, shiftDate(today, 30))),
        ),
      )
      .orderBy(desc(employeeLeaves.fromDate), desc(employeeLeaves.createdAt))
      .limit(500);
    return c.json({ today, leaves: await withTasks(db, rows) });
  })
  .post("/leaves", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = leaveInput.parse(await c.req.json());
    const e = await loadEmployee(db, userId, v.employeeId);
    const t = await loadType(db, userId, v.typeId);
    if (!t.active) throw new HTTPException(400, { message: `${t.name} is switched off in Settings › Leave` });
    if (v.extensionOfId) {
      const first = await loadLeave(db, userId, v.extensionOfId);
      if (first.employeeId !== e.id) throw new HTTPException(400, { message: "That leave is someone else's" });
    }
    await checkOverlap(db, e.id, v.fromDate, v.toDate, null);
    const [l] = await db
      .insert(employeeLeaves)
      .values({ userId, employeeId: e.id, typeId: t.id, fromDate: v.fromDate, toDate: v.toDate, days: v.days, onMedical: v.onMedical, orderNo: v.orderNo, orderDate: v.orderDate, notes: v.notes, extensionOfId: v.extensionOfId })
      .returning();
    await takeDays(db, userId, l!, t);
    const checklist = leaveSteps(e.gazetted).map((s) => ({ id: s.id, text: s.text, done: v.doneSteps.includes(s.id) }));
    const [task] = await db
      .insert(tasks)
      .values({
        userId,
        title: leaveTitle(e.name, t, v.days),
        notes: taskNotes(l!, t),
        dueDate: rejoinDay(l!),
        priority: "high",
        checklist,
        relatedKind: "employee",
        relatedId: e.id,
        madeBySystem: true,
        systemKind: "leave",
      })
      .returning();
    await db.update(employeeLeaves).set({ taskId: task!.id }).where(eq(employeeLeaves.id, l!.id));
    await db.insert(events).values({ userId, entityType: "task", entityId: task!.id, action: "task.created", summary: `Made by system: ${e.gazetted ? "gazetted" : "non-gazetted"} leave steps`, detail: { title: task!.title } });
    // Every step already done (leave entered late): completed straight away.
    await settleLeaveTask(db, userId, task!, [], checklist);
    await log(db, userId, "staff.leave_marked", `Leave of ${e.name}: ${t.name}, ${daysWord(v.days)}, ${dayLabel(v.fromDate)} to ${dayLabel(v.toDate)}${v.extensionOfId ? " (extension)" : ""}`);
    // A leave that doesn't count for increment or probation (EOL, unless on a medical certificate): those dates move
    // by its days when asked.
    const postponed = t.delaysIncrement && !v.onMedical ? await postpone(db, userId, e, l!, t, v.postpone) : {};
    return c.json({ id: l!.id, taskId: task!.id, postponed }, 201);
  })
  // The form sends every field. A change of type, dates or days gives the old days back and takes the new ones;
  // rejoinedOn records the joining report (curtailed when earlier than the day after the leave).
  .put("/leaves/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const l = await loadLeave(db, userId, c.req.param("id"));
    if (l.status === "cancelled") throw new HTTPException(409, { message: "This leave was cancelled" });
    const v = leavePatch.parse(await c.req.json());
    const e = await loadEmployee(db, userId, l.employeeId);
    const t = await loadType(db, userId, v.typeId);
    await checkOverlap(db, e.id, v.fromDate, v.rejoinedOn ? leaveEnd({ toDate: v.toDate, rejoinedOn: v.rejoinedOn }) : v.toDate, l.id);
    const [saved] = await db
      .update(employeeLeaves)
      .set({ typeId: t.id, fromDate: v.fromDate, toDate: v.toDate, days: v.days, onMedical: v.onMedical, orderNo: v.orderNo, orderDate: v.orderDate, notes: v.notes, rejoinedOn: v.rejoinedOn, updatedAt: new Date() })
      .where(eq(employeeLeaves.id, l.id))
      .returning();
    if (t.id !== l.typeId || v.days !== l.days || v.fromDate !== l.fromDate || v.toDate !== l.toDate) {
      await giveBack(db, userId, l.id, "Leave changed");
      await takeDays(db, userId, saved!, t);
    }
    if (l.taskId) await db.update(tasks).set({ title: leaveTitle(e.name, t, v.days), notes: taskNotes(saved!, t), dueDate: rejoinDay(saved!), updatedAt: new Date() }).where(eq(tasks.id, l.taskId));
    if (v.rejoinedOn && v.rejoinedOn !== l.rejoinedOn) await log(db, userId, "staff.leave_rejoined", `${e.name} rejoined on ${dayLabel(v.rejoinedOn)} after ${t.name} (${daysWord(v.days)})`);
    else await log(db, userId, "staff.leave_changed", `Leave of ${e.name} changed: ${t.name}, ${daysWord(v.days)}, ${dayLabel(v.fromDate)} to ${dayLabel(v.toDate)}`);
    return c.json({ ok: true });
  })
  // Undo of the dates a leave moved: each goes back only while it is still the moved date.
  .post("/leaves/:id/postpone/undo", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const l = await loadLeave(db, userId, c.req.param("id"));
    const e = await loadEmployee(db, userId, l.employeeId);
    const v = postponeUndoInput.parse(await c.req.json());
    if (v.increment) {
      const [back] = await db
        .update(employees)
        .set({ nextIncrementOn: v.increment.from, updatedAt: new Date() })
        .where(and(eq(employees.id, e.id), eq(employees.nextIncrementOn, v.increment.to)))
        .returning({ id: employees.id });
      if (back) await log(db, userId, "staff.increment_postponed_undone", `Next increment of ${e.name} back to ${dayLabel(v.increment.from)}`);
    }
    if (v.probation) {
      const [back] = await db
        .update(tasks)
        .set({ dueDate: v.probation.from, updatedAt: new Date() })
        .where(and(eq(tasks.id, v.probation.taskId), eq(tasks.userId, userId), eq(tasks.dueDate, v.probation.to)))
        .returning({ id: tasks.id, title: tasks.title });
      if (back) await db.insert(events).values({ userId, entityType: "task", entityId: back.id, action: "task.rescheduled", summary: `Due date set to ${v.probation.from}`, detail: { title: back.title } });
    }
    return c.json({ ok: true });
  })
  // Surrender of earned leave (phase 4): the days come off the balance (a "surrender" line) and a task with the
  // surrender steps is made, due a week after the date.
  .post("/accounts/:employeeId/surrender", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const e = await loadEmployee(db, userId, c.req.param("employeeId"));
    const v = leaveSurrenderInput.parse(await c.req.json());
    const t = await loadType(db, userId, v.typeId);
    if (!t.hasAccount) throw new HTTPException(400, { message: `${t.name} keeps no balance to surrender` });
    const note = [v.terminal && "Terminal surrender (retirement)", v.orderNo && `Order ${v.orderNo}`, v.note].filter(Boolean).join(" · ") || "Surrender";
    await db.insert(leaveLedger).values({ userId, employeeId: e.id, typeId: t.id, onDate: v.onDate, days: -v.days, kind: "surrender", note, terminal: v.terminal });
    const checklist = SURRENDER_STEPS.map((s) => ({ id: s.id, text: s.text, done: v.doneSteps.includes(s.id) }));
    const [task] = await db
      .insert(tasks)
      .values({
        userId,
        title: surrenderTitle(e.name, t, v.days),
        notes: [`${v.terminal ? "Terminal surrender" : "Surrender"} of ${daysWord(v.days)} of ${t.name} on ${dayLabel(v.onDate)}.`, v.orderNo && `Order ${v.orderNo}.`, v.note].filter(Boolean).join("\n"),
        dueDate: shiftDate(v.onDate, 7),
        priority: "normal",
        checklist,
        relatedKind: "employee",
        relatedId: e.id,
        madeBySystem: true,
        systemKind: "leave",
      })
      .returning();
    await db.insert(events).values({ userId, entityType: "task", entityId: task!.id, action: "task.created", summary: "Made by system: leave surrender steps", detail: { title: task!.title } });
    await settleLeaveTask(db, userId, task!, [], checklist);
    await log(db, userId, "staff.leave_surrender", `Leave account of ${e.name}: Surrendered ${formatDays(v.days)} ${leaveShort(t)}${v.orderNo ? ` (order ${v.orderNo})` : ""}`);
    return c.json({ taskId: task!.id }, 201);
  })
  // Cancelled: the days come back and the open task is completed (both kept, with History).
  .post("/leaves/:id/cancel", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const l = await loadLeave(db, userId, c.req.param("id"));
    if (l.status === "cancelled") return c.json({ ok: true });
    const e = await loadEmployee(db, userId, l.employeeId);
    const t = await loadType(db, userId, l.typeId);
    await db.update(employeeLeaves).set({ status: "cancelled", updatedAt: new Date() }).where(eq(employeeLeaves.id, l.id));
    await giveBack(db, userId, l.id, "Leave cancelled");
    if (l.taskId) {
      const [done] = await db
        .update(tasks)
        .set({ status: "done", completedAt: new Date(), waitingSince: null, replyBy: null, updatedAt: new Date() })
        .where(and(eq(tasks.id, l.taskId), eq(tasks.status, "open")))
        .returning({ id: tasks.id, title: tasks.title });
      if (done) await db.insert(events).values({ userId, entityType: "task", entityId: done.id, action: "task.completed", summary: "Completed: leave cancelled", detail: { title: done.title } });
    }
    await log(db, userId, "staff.leave_cancelled", `Leave of ${e.name} cancelled: ${t.name}, ${daysWord(l.days)}, ${dayLabel(l.fromDate)} to ${dayLabel(l.toDate)}`);
    return c.json({ ok: true });
  });

// Moves the employee's next increment date and their open Probation declaration task by the leave's days.
async function postpone(
  db: DB,
  userId: string,
  e: typeof employees.$inferSelect,
  l: typeof employeeLeaves.$inferSelect,
  t: typeof leaveTypes.$inferSelect,
  ask: { increment: boolean; probation: boolean },
): Promise<LeavePostponed> {
  const n = postponeDays(l.days);
  const out: LeavePostponed = {};
  if (ask.increment && e.nextIncrementOn) {
    const to = shiftDate(e.nextIncrementOn, n);
    await db.update(employees).set({ nextIncrementOn: to, updatedAt: new Date() }).where(eq(employees.id, e.id));
    await log(db, userId, "staff.increment_postponed", `Next increment of ${e.name} moved from ${dayLabel(e.nextIncrementOn)} to ${dayLabel(to)} (${daysWord(n)} of ${t.name})`);
    out.increment = { from: e.nextIncrementOn, to };
  }
  if (ask.probation && e.probationTaskId) {
    const [p] = await db.select().from(tasks).where(and(eq(tasks.id, e.probationTaskId), eq(tasks.status, "open")));
    if (p?.dueDate) {
      const to = shiftDate(p.dueDate, n);
      await db.update(tasks).set({ dueDate: to, updatedAt: new Date() }).where(eq(tasks.id, p.id));
      await db.insert(events).values({ userId, entityType: "task", entityId: p.id, action: "task.rescheduled", summary: `Due date moved to ${to}: ${daysWord(n)} of ${t.name}`, detail: { title: p.title } });
      out.probation = { taskId: p.id, from: p.dueDate, to };
    }
  }
  return out;
}

async function loadLeave(db: DB, userId: string, id: string) {
  const [l] = await db.select().from(employeeLeaves).where(and(eq(employeeLeaves.id, id), eq(employeeLeaves.userId, userId)));
  if (!l) throw new HTTPException(404, { message: "Leave not found" });
  return l;
}

// Two leaves of one employee can't share a day.
async function checkOverlap(db: DB, employeeId: string, from: string, to: string, exceptId: string | null) {
  const others = await db
    .select()
    .from(employeeLeaves)
    .where(and(eq(employeeLeaves.employeeId, employeeId), eq(employeeLeaves.status, "active"), lte(employeeLeaves.fromDate, to), gte(employeeLeaves.toDate, from), exceptId ? ne(employeeLeaves.id, exceptId) : undefined));
  const clash = others.find((o) => leaveEnd(o) >= from);
  if (clash) throw new HTTPException(409, { message: `Already on leave from ${dayLabel(clash.fromDate)} to ${dayLabel(leaveEnd(clash))}` });
}

// The days a leave takes: from its own type's balance (EL, HPL), from the type it takes from (commuted leave takes
// 2 days of HPL for each day; LND may take HPL below zero), or nothing (EOL, maternity).
async function takeDays(db: DB, userId: string, l: typeof employeeLeaves.$inferSelect, t: typeof leaveTypes.$inferSelect) {
  const from = t.hasAccount ? { typeId: t.id, perDay: 1 } : t.drawsOnId ? { typeId: t.drawsOnId, perDay: t.perDay } : null;
  if (!from) return;
  const note = `${t.name}, ${dayLabel(l.fromDate)} to ${dayLabel(leaveEnd(l))}${from.perDay === 1 ? "" : ` (${formatDays(l.days)} days × ${formatDays(from.perDay)})`}`;
  await db.insert(leaveLedger).values({ userId, employeeId: l.employeeId, typeId: from.typeId, onDate: l.fromDate, days: -l.days * from.perDay, kind: "leave", leaveId: l.id, note });
}

// Gives back what a leave's lines took, as "cancel" lines (the lines themselves stay).
async function giveBack(db: DB, userId: string, leaveId: string, note: string) {
  const sums = await db
    .select({ employeeId: leaveLedger.employeeId, typeId: leaveLedger.typeId, total: sql<string>`sum(${leaveLedger.days})` })
    .from(leaveLedger)
    .where(eq(leaveLedger.leaveId, leaveId))
    .groupBy(leaveLedger.employeeId, leaveLedger.typeId);
  const back = sums.filter((s) => Number(s.total) !== 0);
  if (back.length) {
    const [l] = await db.select({ fromDate: employeeLeaves.fromDate }).from(employeeLeaves).where(eq(employeeLeaves.id, leaveId));
    await db.insert(leaveLedger).values(back.map((s) => ({ userId, employeeId: s.employeeId, typeId: s.typeId, onDate: l!.fromDate, days: -Number(s.total), kind: "cancel" as const, leaveId, note })));
  }
}

function taskNotes(l: typeof employeeLeaves.$inferSelect, t: typeof leaveTypes.$inferSelect) {
  return [
    `${t.name}, ${dayLabel(l.fromDate)} to ${dayLabel(l.toDate)} (${daysWord(l.days)})${l.onMedical ? ", on a medical certificate" : ""}.`,
    l.orderNo || l.orderDate ? `Order ${[l.orderNo, l.orderDate && dayLabel(l.orderDate)].filter(Boolean).join(" dated ")}.` : "",
    l.rejoinedOn ? `Rejoined on ${dayLabel(l.rejoinedOn)}.` : `Due back on ${dayLabel(rejoinDay(l))}.`,
    l.notes,
  ]
    .filter(Boolean)
    .join("\n");
}

async function withTasks(db: DB, rows: (typeof employeeLeaves.$inferSelect)[]): Promise<EmployeeLeave[]> {
  const ids = rows.map((r) => r.taskId).filter((x): x is string => !!x);
  const found = ids.length ? (await selectTasks(db).where(inArray(tasks.id, ids))).map(toTask) : [];
  const byId = new Map<string, Task>(found.map((t) => [t.id, t]));
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    typeId: r.typeId,
    fromDate: r.fromDate,
    toDate: r.toDate,
    days: r.days,
    orderNo: r.orderNo,
    orderDate: r.orderDate,
    notes: r.notes,
    rejoinedOn: r.rejoinedOn,
    onMedical: r.onMedical,
    status: r.status,
    extensionOfId: r.extensionOfId,
    task: (r.taskId && byId.get(r.taskId)) || null,
  }));
}
