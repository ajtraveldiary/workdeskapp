// Joining and relieving (user request 2026-10-15), mounted at /api/moves. Join: the employee is back in the office
// with the date as "joined this office". Relieve: they are marked Left the office on the relieving date (user's
// choice). Each makes its task (lib/moves.ts). The table's step changes write the task's checklist, so the task and
// the table always agree. Only WorkDesk's database changes; every join / relieve goes in History.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { designations, employeeMoves, employees, events, tasks } from "../db/schema";
import { moveInput, moveStepInput } from "../../shared/schemas";
import { MOVE_STEPS, stepState, withState } from "../../shared/moves";
import { stampChecklist } from "../lib/checklist";
import { dayLabel } from "../../shared/reminderSchedule";
import type { StaffMove } from "../../shared/types";
import { settleMoveTask, startMove } from "../lib/moves";

const log = (db: DB, userId: string, action: string, summary: string) => db.insert(events).values({ userId, entityType: "sync", action, summary });

export const moveRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const rows = await db
      .select({ m: employeeMoves, name: employees.name, designation: designations.name, status: tasks.status, checklist: tasks.checklist })
      .from(employeeMoves)
      .innerJoin(employees, eq(employees.id, employeeMoves.employeeId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(tasks, eq(tasks.id, employeeMoves.taskId))
      .where(eq(employeeMoves.userId, userId))
      .orderBy(desc(employeeMoves.onDate), desc(employeeMoves.createdAt));
    const moves = rows.map(
      (r): StaffMove => ({
        id: r.m.id,
        kind: r.m.kind,
        employeeId: r.m.employeeId,
        name: r.name,
        designation: r.designation,
        onDate: r.m.onDate,
        taskId: r.m.taskId,
        finished: !r.status || r.status === "done",
        steps: MOVE_STEPS[r.m.kind].map((s) => ({ id: s.id, state: stepState((r.checklist ?? []).find((i) => i.id === s.id)) })),
      }),
    );
    return c.json({ moves });
  })

  .post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { employeeId, kind, date, doneSteps } = moveInput.parse(await c.req.json());
    const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.userId, userId)));
    if (!e) throw new HTTPException(404, { message: "Employee not found" });
    // Someone marked Left the office without a relieving record can still be put into the relieving process
    // (Settings › Employees, user request 2026-10-16); only a second relieving in a row is refused.
    if (kind === "relieve" && e.leftOn) {
      const [last] = await db.select({ kind: employeeMoves.kind }).from(employeeMoves).where(eq(employeeMoves.employeeId, e.id)).orderBy(desc(employeeMoves.onDate), desc(employeeMoves.createdAt)).limit(1);
      if (last?.kind === "relieve") throw new HTTPException(409, { message: `${e.name} has already been relieved` });
    }
    await db
      .update(employees)
      .set(kind === "join" ? { leftOn: null, joinedOfficeOn: date, updatedAt: new Date() } : { leftOn: date, updatedAt: new Date() })
      .where(eq(employees.id, e.id));
    const { move, task } = await startMove(db, userId, e, kind, date, doneSteps);
    await log(db, userId, kind === "join" ? "staff.joined" : "staff.relieved", kind === "join" ? `${e.name} joined on ${dayLabel(date)}` : `${e.name} relieved on ${dayLabel(date)}`);
    return c.json({ id: move.id, taskId: task.id }, 201);
  })

  // One step from the table: pending, waiting or done (the task's checklist item changes).
  .post("/:id/step", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { step, state } = moveStepInput.parse(await c.req.json());
    const [m] = await db.select().from(employeeMoves).where(and(eq(employeeMoves.id, c.req.param("id")), eq(employeeMoves.userId, userId)));
    if (!m) throw new HTTPException(404, { message: "Not found" });
    const [t] = m.taskId ? await db.select().from(tasks).where(eq(tasks.id, m.taskId)) : [];
    if (!t) throw new HTTPException(409, { message: "Its task was deleted" });
    const before = t.checklist ?? [];
    const known = MOVE_STEPS[m.kind].find((s) => s.id === step);
    if (!known) throw new HTTPException(400, { message: "Unknown step" });
    // A step taken out of the task comes back where it belongs.
    const has = before.some((i) => i.id === step);
    const after = has ? before.map((i) => (i.id === step ? withState(i, state) : i)) : [...before, withState({ id: known.id, text: known.text, done: false }, state)];
    await db.update(tasks).set({ checklist: stampChecklist(before, after), updatedAt: new Date() }).where(eq(tasks.id, t.id));
    await settleMoveTask(db, userId, t, before, after);
    return c.json({ ok: true });
  });
