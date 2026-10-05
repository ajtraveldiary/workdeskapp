import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { events, reportPeriods, reports, tasks } from "../db/schema";
import { timezone } from "../env";
import { todayIn } from "../lib/dates";
import { ensureReportPeriods, setPeriodStatus } from "../lib/reports";
import { reportInput, reportPatch } from "../../shared/schemas";
import { periodsFrom, type ScheduleRule } from "../../shared/reportSchedule";
import type { Report } from "../../shared/types";

// Periods returned per report (newest first); enough for a year of monthly history plus what's ahead.
const PERIODS_SHOWN = 18;

const alignedStart = (rule: ScheduleRule, day: string) => periodsFrom(rule, day, () => true, 1)[0]!.periodStart;

async function loadReport(db: DB, userId: string, id: string) {
  const [r] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, id), eq(reports.userId, userId)));
  if (!r) throw new HTTPException(404, { message: "Report not found" });
  return r;
}

export const reportRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const today = todayIn(timezone(c.env));
    await ensureReportPeriods(db, today, userId);

    const rows = await db.select().from(reports).where(eq(reports.userId, userId)).orderBy(desc(reports.active), asc(reports.name));
    const ids = rows.map((r) => r.id);
    const periods = ids.length
      ? await db.select().from(reportPeriods).where(inArray(reportPeriods.reportId, ids)).orderBy(desc(reportPeriods.periodStart))
      : [];
    const periodIds = periods.map((p) => p.id);
    const links = periodIds.length
      ? await db.select({ id: tasks.id, periodId: tasks.reportPeriodId }).from(tasks).where(inArray(tasks.reportPeriodId, periodIds))
      : [];
    const taskByPeriod = new Map(links.map((l) => [l.periodId, l.id]));

    const result: Report[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      notes: r.notes,
      frequency: r.frequency,
      dueDay: r.dueDay,
      dueMonthOffset: r.dueMonthOffset,
      yearStartMonth: r.yearStartMonth,
      leadDays: r.leadDays,
      priority: r.priority,
      categoryId: r.categoryId,
      responsible: r.responsible,
      firstPeriodStart: r.firstPeriodStart,
      active: r.active,
      periods: periods
        .filter((p) => p.reportId === r.id)
        .slice(0, PERIODS_SHOWN)
        .map((p) => ({
          id: p.id,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          label: p.label,
          dueDate: p.dueDate,
          status: p.status,
          submittedAt: p.submittedAt?.toISOString() ?? null,
          taskId: taskByPeriod.get(p.id) ?? null,
        })),
    }));
    return c.json({ reports: result, today });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = reportInput.parse(await c.req.json());
    const [r] = await db
      .insert(reports)
      .values({ ...input, userId, firstPeriodStart: alignedStart(input, input.firstPeriodStart) })
      .returning();
    await db.insert(events).values({ userId, entityType: "report", entityId: r!.id, action: "report.created", summary: "Report created", detail: { title: r!.name } });
    await ensureReportPeriods(db, todayIn(timezone(c.env)), userId);
    return c.json(r, 201);
  })

  // Schedule changes apply to periods created from now on; existing periods keep their due dates.
  .patch("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = reportPatch.parse(await c.req.json());
    const r = await loadReport(db, userId, c.req.param("id"));
    const merged = { ...r, ...input };
    const set = { ...input, updatedAt: new Date(), ...(input.firstPeriodStart ? { firstPeriodStart: alignedStart(merged, input.firstPeriodStart) } : {}) };
    await db.update(reports).set(set).where(eq(reports.id, r.id));
    const action = input.active === false && r.active ? "report.paused" : input.active === true && !r.active ? "report.resumed" : "report.updated";
    const summary = action === "report.paused" ? "Paused" : action === "report.resumed" ? "Resumed" : "Report settings changed";
    await db.insert(events).values({ userId, entityType: "report", entityId: r.id, action, summary, detail: { title: merged.name } });
    await ensureReportPeriods(db, todayIn(timezone(c.env)), userId);
    return c.json({ ok: true });
  })

  // Removes the report and its periods. Open generated tasks go with it; completed ones stay in history.
  .delete("/:id", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const r = await loadReport(db, userId, c.req.param("id"));
    const periodIds = (await db.select({ id: reportPeriods.id }).from(reportPeriods).where(eq(reportPeriods.reportId, r.id))).map((p) => p.id);
    if (periodIds.length) {
      await db.delete(tasks).where(and(inArray(tasks.reportPeriodId, periodIds), eq(tasks.status, "open")));
    }
    await db.delete(reports).where(eq(reports.id, r.id));
    await db.insert(events).values({ userId, entityType: "report", entityId: r.id, action: "report.deleted", summary: "Report deleted", detail: { title: r.name } });
    return c.json({ ok: true });
  })

  .post("/periods/:id/submit", async (c) => {
    const p = await setPeriodStatus(c.get("db"), c.get("userId"), c.req.param("id"), "submitted");
    if (!p) throw new HTTPException(404, { message: "Period not found" });
    return c.json({ ok: true });
  })

  .post("/periods/:id/reopen", async (c) => {
    const p = await setPeriodStatus(c.get("db"), c.get("userId"), c.req.param("id"), "pending");
    if (!p) throw new HTTPException(404, { message: "Period not found" });
    return c.json({ ok: true });
  });
