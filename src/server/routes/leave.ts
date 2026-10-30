// Leave (user request 2026-10-30, plan in docs/LEAVE_PLAN.md). Phase 1: the leave types of Settings › Leave and each
// permanent employee's leave account: opening balances, credits and adjustments by hand, and "Credit now" for
// everyone. The account is never rewritten (lines are only added); every change is in History, naming the
// employee so it shows on their page.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { employees, events, leaveLedger, leaveTypes } from "../db/schema";
import { leaveCreditInput, leaveLineInput, leaveTypeInput, orderInput } from "../../shared/schemas";
import { LEDGER_LABEL, USUAL_LEAVE_TYPES, daysWord, formatDays, leaveShort } from "../../shared/leave";
import type { LeaveAccount, LeaveCreditPlan, LeaveType } from "../../shared/types";
import { saveOrder } from "./staff";

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
async function checkedType(db: DB, userId: string, raw: unknown, self?: typeof leaveTypes.$inferSelect) {
  const v = leaveTypeInput.parse(raw);
  const same = await db.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.userId, userId), sql`lower(${leaveTypes.name}) = ${lower(v.name)}`));
  if (same.some((x) => x.id !== self?.id)) throw new HTTPException(409, { message: `There is already a leave type called ${v.name}` });
  if (v.drawsOnId) {
    if (v.drawsOnId === self?.id) throw new HTTPException(400, { message: "A leave type can't take from its own balance" });
    const other = await loadType(db, userId, v.drawsOnId);
    if (!other.hasAccount) throw new HTTPException(400, { message: `${other.name} keeps no balance of its own to take from` });
  }
  const hasAccount = v.drawsOnId ? false : v.hasAccount;
  if (self && self.hasAccount && !hasAccount) {
    const [n] = await db.select({ n: count() }).from(leaveLedger).where(eq(leaveLedger.typeId, self.id));
    if (Number(n?.n ?? 0) > 0) throw new HTTPException(409, { message: `${self.name} has lines in leave accounts, so it keeps its own balance` });
  }
  if (self && !hasAccount) {
    const [d] = await db.select({ n: count() }).from(leaveTypes).where(eq(leaveTypes.drawsOnId, self.id));
    if (Number(d?.n ?? 0) > 0) throw new HTTPException(409, { message: `Other leave types take from ${self.name}, so it keeps its own balance` });
  }
  return hasAccount
    ? { ...v, hasAccount, drawsOnId: null, perDay: 1, mayGoNegative: v.mayGoNegative }
    : { ...v, hasAccount, maxBalance: null, yearlyDays: null, fromDuty: false, mayGoNegative: v.drawsOnId ? v.mayGoNegative : false, perDay: v.drawsOnId ? v.perDay : 1 };
}

async function listTypes(db: DB, userId: string): Promise<LeaveType[]> {
  const [rows, used] = await Promise.all([
    db.select().from(leaveTypes).where(eq(leaveTypes.userId, userId)).orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name)),
    db.select({ typeId: leaveLedger.typeId, n: count() }).from(leaveLedger).where(eq(leaveLedger.userId, userId)).groupBy(leaveLedger.typeId),
  ]);
  const lines = new Map(used.map((u) => [u.typeId, Number(u.n)]));
  return rows.map((t) => {
    const { userId: _u, createdAt: _c, ...rest } = t;
    return { ...rest, lines: lines.get(t.id) ?? 0 };
  });
}

// Each employee's balance of one type, for the employees given.
async function balancesOf(db: DB, typeId: string, employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, number>();
  const rows = await db
    .select({ employeeId: leaveLedger.employeeId, total: sql<string>`sum(${leaveLedger.days})` })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.typeId, typeId), inArray(leaveLedger.employeeId, employeeIds)))
    .groupBy(leaveLedger.employeeId);
  return new Map(rows.map((r) => [r.employeeId, Number(r.total)]));
}

// A credit that takes a balance above the type's maximum: the extra lapses, as its own line.
async function lapseAbove(db: DB, userId: string, type: typeof leaveTypes.$inferSelect, employeeIds: string[], onDate: string) {
  if (type.maxBalance == null || !employeeIds.length) return 0;
  const bal = await balancesOf(db, type.id, employeeIds);
  const over = employeeIds.map((id) => ({ id, extra: (bal.get(id) ?? 0) - type.maxBalance! })).filter((x) => x.extra > 0);
  if (over.length)
    await db.insert(leaveLedger).values(
      over.map((x) => ({ userId, employeeId: x.id, typeId: type.id, onDate, days: -x.extra, kind: "lapse" as const, note: `Above the most that can be kept (${daysWord(type.maxBalance!)})` })),
    );
  return over.length;
}

export const leaveRoutes = new Hono<AppEnv>()
  // --- Leave types (Settings › Leave) ---
  .get("/types", async (c) => c.json({ types: await listTypes(c.get("db"), c.get("userId")) }))
  .post("/types", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const v = await checkedType(db, userId, await c.req.json());
    const [m] = await db.select({ m: max(leaveTypes.sortOrder) }).from(leaveTypes).where(eq(leaveTypes.userId, userId));
    const [t] = await db.insert(leaveTypes).values({ ...v, userId, sortOrder: (m?.m ?? 0) + 1 }).returning({ id: leaveTypes.id });
    await log(db, userId, "staff.leave_type_added", `Leave type added: ${v.name}`);
    return c.json(t, 201);
  })
  // The Kerala Service Rules leaves (USUAL_LEAVE_TYPES); ones already there (same name) are skipped.
  .post("/types/usual", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const have = await db.select().from(leaveTypes).where(eq(leaveTypes.userId, userId));
    const names = new Set(have.map((t) => lower(t.name)));
    const byShort = new Map(have.map((t) => [lower(t.short), t]));
    let order = Math.max(0, ...have.map((t) => t.sortOrder));
    let added = 0;
    // One at a time, in order, so commuted leave and LND find the HPL just made.
    for (const u of USUAL_LEAVE_TYPES) {
      if (names.has(lower(u.name))) continue;
      const from = u.drawsOn ? byShort.get(lower(u.drawsOn)) : undefined;
      const drawsOnId = from?.hasAccount ? from.id : null;
      const [t] = await db
        .insert(leaveTypes)
        .values({
          userId,
          name: u.name,
          short: u.short,
          sortOrder: ++order,
          hasAccount: u.hasAccount,
          drawsOnId,
          perDay: drawsOnId ? (u.perDay ?? 1) : 1,
          mayGoNegative: !!drawsOnId && !!u.mayGoNegative,
          maxBalance: u.maxBalance ?? null,
          serviceLimit: u.serviceLimit ?? null,
          medical: !!u.medical,
          yearlyDays: u.yearlyDays ?? null,
          fromDuty: !!u.fromDuty,
        })
        .returning();
      byShort.set(lower(u.short), t!);
      added++;
    }
    if (added) await log(db, userId, "staff.leave_types_usual", `Added ${added} usual leave type${added === 1 ? "" : "s"}`);
    return c.json({ added });
  })
  // The form sends every field.
  .put("/types/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const t = await loadType(db, userId, c.req.param("id"));
    const v = await checkedType(db, userId, await c.req.json(), t);
    await db.update(leaveTypes).set(v).where(eq(leaveTypes.id, t.id));
    await log(db, userId, "staff.leave_type_changed", t.name === v.name ? `Leave type changed: ${v.name}` : `Leave type changed: ${t.name} → ${v.name}`);
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
    const [n] = await db.select({ n: count() }).from(leaveLedger).where(eq(leaveLedger.typeId, t.id));
    if (Number(n?.n ?? 0) > 0) throw new HTTPException(409, { message: `${t.name} is used in leave accounts, so it can't be removed. Rename it instead.` });
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
      .select({ id: leaveLedger.id, typeId: leaveLedger.typeId, onDate: leaveLedger.onDate, days: leaveLedger.days, kind: leaveLedger.kind, creditFor: leaveLedger.creditFor, note: leaveLedger.note, createdAt: leaveLedger.createdAt })
      .from(leaveLedger)
      .where(eq(leaveLedger.employeeId, e.id))
      .orderBy(desc(leaveLedger.onDate), desc(leaveLedger.createdAt));
    const total = new Map<string, number>();
    for (const l of lines) total.set(l.typeId, (total.get(l.typeId) ?? 0) + l.days);
    const types = await db.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.userId, userId), eq(leaveTypes.hasAccount, true))).orderBy(asc(leaveTypes.sortOrder));
    const account: LeaveAccount = {
      balances: types.map((t) => ({ typeId: t.id, balance: Math.round((total.get(t.id) ?? 0) * 10) / 10 })),
      lines: lines.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
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
  });
