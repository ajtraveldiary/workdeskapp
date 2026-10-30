// Leave, phases 1 to 4 (user request 2026-10-30, docs/LEAVE_PLAN.md): leave types, each permanent employee's leave
// account (opening balance, credits, adjustments, lapse above the most that can be kept), "Credit now" once per
// year, the Gazetted switch (filled from the designation) and the Probation declared switch (no probation task
// while it is yes). Then the built-in Kerala Service Rules types and their limits (warnings), the medical
// certificate tick and terminal surrender.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { ensureProbationTasks } from "../src/server/lib/probation";
import { ensureLeaveCredits } from "../src/server/lib/leave";
import { KSR_LEAVE_TYPES, financialYearStart, leaveWarnings, spellDays } from "../src/shared/leave";
import { BACKUP_TABLES } from "../src/shared/transfer";
import { eq as eqId } from "drizzle-orm";
import { yearBefore } from "../src/shared/staff";
import type { AuditEvent, Employee, EmployeeLeave, LeaveAccount, LeaveType, StaffList, Task } from "../src/shared/types";

const NAME = "ശ്രീമതി. ലക്ഷ്മി കുട്ടി അമ്മ കെ. എസ്. (ജൂനിയർ പബ്ലിക് ഹെൽത്ത് നഴ്സ്, പ്രാഥമികാരോഗ്യ കേന്ദ്രം)";

describe("leave", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const types = async () => (await call("GET", "/leave/types")).json.types as LeaveType[];
  const byShort = async (short: string) => (await types()).find((t) => t.short === short)!;
  const account = async (id: string) => (await call("GET", `/leave/accounts/${id}`)).json as LeaveAccount;
  const balance = async (id: string, typeId: string) => (await account(id)).balances.find((b) => b.typeId === typeId)!.balance;
  const staff = async () => (await call("GET", "/staff")).json as StaffList;
  const employee = async (id: string) => (await staff()).employees.find((e) => e.id === id)! as Employee;
  const history = async () => (await call("GET", "/history")).json.events as AuditEvent[];
  const add = async (body: Record<string, unknown>) => (await call("POST", "/staff/employees", body)).json.id as string;

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("has the KSR leave types built in, with commuted leave and LND taking from HPL", async () => {
    const list = await types();
    expect((await call("POST", "/leave/types/usual")).json.added).toBe(0);
    const hpl = list.find((t) => t.short === "HPL")!;
    expect(list.map((t) => t.ksrKey)).toEqual(KSR_LEAVE_TYPES.map((k) => k.key));
    expect(list.map((t) => t.short)).toEqual(["EL", "HPL", "Commuted", "LND", "EOL", "ML", "ML (miscarriage)", "Hysterectomy", "PL", "Adoption", "SDL", "Hospital"]);
    expect(hpl).toMatchObject({ hasAccount: true, yearlyDays: 20, drawsOnId: null, rule: "KSR Part I, Rules 82, 83", active: true });
    expect(list.find((t) => t.short === "EL")).toMatchObject({ hasAccount: true, fromDuty: true, maxBalance: 300, atOnce: 180, spellLimit: 240, surrenderPerYear: 30, terminalSurrender: 300 });
    expect(list.find((t) => t.short === "Commuted")).toMatchObject({ hasAccount: false, drawsOnId: hpl.id, perDay: 2, medical: true, spellLimit: 240 });
    expect(list.find((t) => t.short === "LND")).toMatchObject({ hasAccount: false, drawsOnId: hpl.id, mayGoNegative: true, serviceLimit: 360, nonMedicalAtOnce: 90, nonMedicalLimit: 180, lastResort: true, medical: false });
    expect(list.find((t) => t.short === "EOL")).toMatchObject({ hasAccount: false, drawsOnId: null, delaysIncrement: true });
    expect(list.find((t) => t.short === "PL")).toMatchObject({ atOnce: 10, serviceLimit: 20 });
    expect(list.find((t) => t.short === "SDL")).toMatchObject({ atOnce: 730, medical: true });
  });

  it("an older type of the same name becomes the KSR one, keeping its figures", async () => {
    // Made before the list was read (as "Add the usual leaves" did, or a backup).
    await call("POST", "/leave/types", { name: "Earned leave", short: "EL", hasAccount: true, maxBalance: 240 });
    const list = await types();
    expect(list).toHaveLength(12);
    expect(list.filter((t) => t.ksrKey === "el")).toHaveLength(1);
    expect(list.find((t) => t.ksrKey === "el")).toMatchObject({ maxBalance: 240, rule: "KSR Part I, Rules 78, 79", atOnce: 180, spellLimit: 240, surrenderPerYear: 30 });
  });

  it("KSR types can be edited, reset and switched off, never removed", async () => {
    const lnd = await byShort("LND");
    const hpl = await byShort("HPL");
    const edit = { name: "Leave not due", short: "LND", hasAccount: false, drawsOnId: hpl.id, perDay: 1, mayGoNegative: true, serviceLimit: 300, rule: "KSR Part I, Rule 85", active: false };
    expect((await call("PUT", `/leave/types/${lnd.id}`, edit)).status).toBe(200);
    expect(await byShort("LND")).toMatchObject({ serviceLimit: 300, perDay: 1, active: false, nonMedicalAtOnce: null });
    expect((await call("DELETE", `/leave/types/${lnd.id}`)).status).toBe(409);
    // Switched off: not offered, and Mark leave refuses it.
    const id = await add({ name: NAME });
    expect((await call("POST", "/leave/leaves", { employeeId: id, typeId: lnd.id, fromDate: "2026-12-01", toDate: "2026-12-02" , days: 2 })).status).toBe(400);
    // Reset puts the KSR figures back and keeps it switched off.
    expect((await call("POST", `/leave/types/${lnd.id}/reset`)).status).toBe(200);
    expect(await byShort("LND")).toMatchObject({ serviceLimit: 360, perDay: 1, drawsOnId: hpl.id, mayGoNegative: true, nonMedicalAtOnce: 90, nonMedicalLimit: 180, lastResort: true, active: false });
    expect((await history()).some((h) => h.summary === "Leave type reset to the KSR figures: Leave not due")).toBe(true);
    // The office's own type has no KSR figures to go back to, and can be removed.
    const own = (await call("POST", "/leave/types", { name: "Study leave", hasAccount: false })).json.id as string;
    expect((await call("POST", `/leave/types/${own}/reset`)).status).toBe(400);
    expect((await call("DELETE", `/leave/types/${own}`)).status).toBe(200);
  });

  it("the KSR limits are warnings: at a time, without a medical certificate, one run of EL and commuted leave, LND last", async () => {
    const t = (o: Partial<Parameters<typeof leaveWarnings>[0]["type"]>) => ({ name: "Leave not due", short: "LND", rule: "KSR Part I, Rule 85", medical: false, atOnce: null, nonMedicalAtOnce: null, nonMedicalLimit: null, spellLimit: null, lastResort: false, ...o });
    const base = { days: 10, onMedical: false, usedNonMedical: 0, spell: 10, atCredit: [] };
    expect(leaveWarnings({ ...base, type: t({}) })).toEqual([]);
    expect(leaveWarnings({ ...base, type: t({ name: "Commuted leave", short: "Commuted", rule: "KSR Part I, Rules 84, 74", medical: true }) })).toEqual(["Commuted leave is given on a medical certificate (KSR Part I, Rules 84, 74)."]);
    expect(leaveWarnings({ ...base, days: 181, type: t({ name: "Earned leave", short: "EL", rule: "KSR Part I, Rules 78, 79", atOnce: 180 }) })).toEqual(["At most 180 days of EL at a time (KSR Part I, Rules 78, 79)."]);
    const lnd = t({ nonMedicalAtOnce: 90, nonMedicalLimit: 180, lastResort: true });
    expect(leaveWarnings({ ...base, days: 100, usedNonMedical: 90, type: lnd, atCredit: [{ short: "EL", balance: 12 }, { short: "HPL", balance: 0 }] })).toEqual([
      "Without a medical certificate, at most 90 days of LND at a time (KSR Part I, Rule 85).",
      "Without a medical certificate, at most 180 days of LND in the whole service; this makes 190 (KSR Part I, Rule 85).",
      "Leave not due is given only when no other leave is at credit: EL 12 (KSR Part I, Rule 85).",
    ]);
    // On a medical certificate the non-medical limits don't apply.
    expect(leaveWarnings({ ...base, days: 100, onMedical: true, usedNonMedical: 90, type: lnd })).toEqual([]);
    expect(leaveWarnings({ ...base, spell: 250, type: t({ spellLimit: 240 }) })).toEqual(["This run of leave comes to 250 days; at most 240 days at a time together (KSR Part I, Rule 85)."]);
    // One run: leaves of the spell types that touch it, one after another (not other types, not a gap, not cancelled).
    const L = (id: string, typeId: string, fromDate: string, toDate: string, days: number, status = "active") => ({ id, typeId, fromDate, toDate, rejoinedOn: null, days, status });
    const leaves = [L("a", "el", "2026-01-01", "2026-03-31", 90), L("b", "com", "2026-04-01", "2026-05-30", 60), L("c", "el", "2026-07-01", "2026-07-10", 10), L("d", "hpl", "2026-06-11", "2026-06-20", 10), L("e", "el", "2026-06-21", "2026-06-30", 10, "cancelled")];
    expect(spellDays(leaves, "2026-05-31", "2026-06-29", 30, new Set(["el", "com"]))).toBe(180);
    expect(spellDays(leaves, "2026-05-31", "2026-06-30", 31, new Set(["el", "com"]))).toBe(191);
    expect(spellDays(leaves, "2026-05-31", "2026-06-30", 31, new Set(["el", "com"]), "a")).toBe(101);
    expect([financialYearStart("2026-11-03"), financialYearStart("2027-03-31"), financialYearStart("2027-04-01")]).toEqual(["2026-04-01", "2026-04-01", "2027-04-01"]);
  });

  it("the Leave page lists every leave, newest first, while the plain list keeps only the ones that matter now", async () => {
    const hpl = await byShort("HPL");
    const eol = await byShort("EOL");
    const a = await add({ name: NAME });
    const b = await add({ name: "Biju" });
    await call("POST", `/leave/accounts/${a}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2020-01-01", days: 40 });
    const today = (await call("GET", "/me")).json.today as string;
    await call("POST", "/leave/leaves", { employeeId: a, typeId: hpl.id, fromDate: "2021-03-01", toDate: "2021-03-05", days: 5 });
    await call("POST", "/leave/leaves", { employeeId: b, typeId: eol.id, fromDate: today, toDate: shift(today, 2), days: 3 });
    const all = (await call("GET", "/leave/leaves?all=1")).json.leaves as EmployeeLeave[];
    expect(all.map((l) => [l.employeeId, l.fromDate])).toEqual([
      [b, today],
      [a, "2021-03-01"],
    ]);
    expect(((await call("GET", "/leave/leaves")).json.leaves as EmployeeLeave[]).map((l) => l.employeeId)).toEqual([b]);
  });

  it("each step of a leave's task keeps when it last changed, so the leave shows the step updated last", async () => {
    const hpl = await byShort("HPL");
    const id = await add({ name: NAME });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    const made = await call("POST", "/leave/leaves", { employeeId: id, typeId: hpl.id, fromDate: "2026-12-01", toDate: "2026-12-05", days: 5, doneSteps: ["application"] });
    const first = await taskOf(made.json.taskId);
    const stamped = first.checklist.filter((i) => i.at).map((i) => i.id);
    expect(stamped).toEqual(["application"]);
    // Ticking a later step, then setting a step to waiting: each gets the time it changed; the others keep theirs.
    const at0 = first.checklist[0]!.at!;
    await new Promise((r) => setTimeout(r, 5));
    await call("PATCH", `/tasks/${first.id}`, { checklist: first.checklist.map((i) => (i.id === "spark" ? { ...i, done: true, at: "1999-01-01T00:00:00Z" } : i)) });
    const second = await taskOf(first.id);
    const spark = second.checklist.find((i) => i.id === "spark")!;
    expect(second.checklist[0]!.at).toBe(at0);
    expect(spark.at! > at0).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await call("PATCH", `/tasks/${first.id}`, { checklist: second.checklist.map((i) => (i.id === "proceedings" ? { ...i, waiting: true } : i)) });
    const third = await taskOf(first.id);
    const latest = [...third.checklist].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))[0]!;
    expect([latest.id, latest.waiting]).toEqual(["proceedings", true]);
    expect(third.checklist.find((i) => i.id === "spark")!.at).toBe(spark.at);
  });

  it("a leave on a medical certificate: kept on the leave, counted apart for LND, and EOL on one moves no dates", async () => {
    const [eol, lnd] = [await byShort("EOL"), await byShort("LND")];
    const id = await add({ name: NAME, nextIncrementOn: "2027-06-01" });
    const mc = await call("POST", "/leave/leaves", { employeeId: id, typeId: eol.id, fromDate: "2026-12-01", toDate: "2026-12-20", days: 20, onMedical: true, postpone: { increment: true, probation: true } });
    expect(mc.json.postponed).toEqual({});
    expect((await employee(id)).nextIncrementOn).toBe("2027-06-01");
    await call("POST", "/leave/leaves", { employeeId: id, typeId: lnd.id, fromDate: "2027-01-01", toDate: "2027-01-10", days: 10, onMedical: true });
    await call("POST", "/leave/leaves", { employeeId: id, typeId: lnd.id, fromDate: "2027-02-01", toDate: "2027-02-05", days: 5 });
    expect((await account(id)).used.find((u) => u.typeId === lnd.id)).toEqual({ typeId: lnd.id, days: 15, nonMedical: 5 });
    const leaves = (await call("GET", `/leave/leaves?employeeId=${id}`)).json.leaves as EmployeeLeave[];
    expect(leaves.map((l) => l.onMedical)).toEqual([false, true, true]);
    expect(leaves[1]!.task!.notes).toContain("on a medical certificate");
  });


  it("checks types: unique names, takes only from a type with a balance, removes only unused ones", async () => {
    await call("POST", "/leave/types/usual");
    const hpl = await byShort("HPL");
    const eol = await byShort("EOL");
    expect((await call("POST", "/leave/types", { name: "half pay leave" })).status).toBe(409);
    expect((await call("POST", "/leave/types", { name: "Special leave", drawsOnId: eol.id })).status).toBe(400);
    // Taking from another type means no balance of its own.
    const sp = (await call("POST", "/leave/types", { name: "Special leave", hasAccount: true, drawsOnId: hpl.id, perDay: 1 })).json.id as string;
    expect((await types()).find((t) => t.id === sp)).toMatchObject({ hasAccount: false, drawsOnId: hpl.id });
    // HPL is taken from, and later used in an account: it can't be removed or lose its balance.
    expect((await call("DELETE", `/leave/types/${hpl.id}`)).status).toBe(409);
    expect((await call("PUT", `/leave/types/${hpl.id}`, { name: "Half pay leave", short: "HPL", hasAccount: false })).status).toBe(409);
    expect((await call("DELETE", `/leave/types/${sp}`)).status).toBe(200);
    const el = await byShort("EL");
    const id = await add({ name: "Anil" });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-01-01", days: 10 });
    expect((await call("DELETE", `/leave/types/${el.id}`)).status).toBe(409);
    expect((await types()).find((t) => t.id === el.id)!.lines).toBe(1);
  });

  it("keeps an account: opening once, credits, adjustments, and the extra above the most that can be kept lapses", async () => {
    await call("POST", "/leave/types/usual");
    const el = await byShort("EL");
    const hpl = await byShort("HPL");
    const id = await add({ name: NAME });
    expect((await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-04-01", days: 290, note: "From service book" })).status).toBe(201);
    expect((await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-04-01", days: 10 })).status).toBe(409);
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "credit", onDate: "2026-06-01", days: 30 });
    // 320 is above EL's 300: 20 lapse.
    expect(await balance(id, el.id)).toBe(300);
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-04-01", days: 46.5 });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "adjust", onDate: "2026-05-01", days: -6.5, note: "Wrong opening" });
    expect(await balance(id, hpl.id)).toBe(40);
    const lines = (await account(id)).lines;
    // Newest first (by date, then as entered).
    expect(lines.map((l) => [l.kind, l.days])).toEqual([
      ["lapse", -20],
      ["credit", 30],
      ["adjust", -6.5],
      ["opening", 46.5],
      ["opening", 290],
    ]);
    // Not allowed: a type without a balance, a credit that takes days away, half-day steps only, temporary staff.
    const eol = await byShort("EOL");
    expect((await call("POST", `/leave/accounts/${id}/lines`, { typeId: eol.id, kind: "credit", onDate: "2026-06-01", days: 5 })).status).toBe(400);
    expect((await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "credit", onDate: "2026-06-01", days: -5 })).status).toBe(400);
    expect((await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "adjust", onDate: "2026-06-01", days: 1.3 })).status).toBe(400);
    const temp = await add({ name: "Daily wage", permanent: false });
    expect((await call("POST", `/leave/accounts/${temp}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-06-01", days: 5 })).status).toBe(400);
    // Every line is in History, naming the employee (so it shows on their page).
    const h = (await history()).map((x) => x.summary);
    expect(h).toContain(`Leave account of ${NAME}: Opening balance 290 EL (From service book)`);
    expect(h).toContain(`Leave account of ${NAME}: Adjustment -6.5 HPL (Wrong opening)`);
    expect(h.some((s) => s.startsWith(`Leave account of ${NAME}: Credit +30 EL`) && s.includes("lapsed"))).toBe(true);
  });

  it("Credit now: everyone permanent still in the office, once per year", async () => {
    await call("POST", "/leave/types/usual");
    const hpl = await byShort("HPL");
    const a = await add({ name: "Anitha" });
    const b = await add({ name: "Biju" });
    await add({ name: "Temporary one", permanent: false });
    const left = await add({ name: "Gone" });
    await call("POST", `/staff/employees/${left}/left`, { left: true });
    const dry = await call("POST", `/leave/types/${hpl.id}/credit`, { creditFor: "2026", onDate: "2026-10-30", days: 20, dryRun: true });
    expect(dry.json.employees.map((e: { name: string }) => e.name)).toEqual(["Anitha", "Biju"]);
    expect(await balance(a, hpl.id)).toBe(0);
    expect((await call("POST", `/leave/types/${hpl.id}/credit`, { creditFor: "2026", onDate: "2026-10-30", days: 20 })).json).toMatchObject({ credited: 2, skipped: 0 });
    expect((await call("POST", `/leave/types/${hpl.id}/credit`, { creditFor: "2026", onDate: "2026-10-30", days: 20 })).json).toMatchObject({ credited: 0, skipped: 2 });
    await call("POST", `/leave/types/${hpl.id}/credit`, { creditFor: "2027", onDate: "2027-10-30", days: 20 });
    expect([await balance(a, hpl.id), await balance(b, hpl.id)]).toEqual([40, 40]);
    expect((await account(a)).lines[0]).toMatchObject({ kind: "credit", creditFor: "2027", note: "Yearly credit for 2027" });
    expect((await history()).some((h) => h.summary === "Credited 20 days HPL for 2026 to 2 employees")).toBe(true);
    const eol = await byShort("EOL");
    expect((await call("POST", `/leave/types/${eol.id}/credit`, { creditFor: "2026", onDate: "2026-10-30", days: 20 })).status).toBe(400);
  });

  it("Gazetted: from the designation for a new employee, follows the post's tick, kept when the form leaves it out", async () => {
    const mo = (await call("POST", "/staff/designations", { name: "Medical Officer" })).json.id as string;
    const clerk = (await call("POST", "/staff/designations", { name: "Clerk" })).json.id as string;
    const doctor = await add({ name: "Dr. Rema", designationId: mo });
    expect((await employee(doctor)).gazetted).toBe(false);
    await call("POST", `/staff/designations/${mo}/gazetted`, { gazetted: true });
    expect((await staff()).designations.find((d) => d.id === mo)!.gazetted).toBe(true);
    expect((await employee(doctor)).gazetted).toBe(true);
    expect((await add({ name: "Dr. Siva", designationId: mo }).then(employee)).gazetted).toBe(true);
    expect((await add({ name: "Dr. Not", designationId: mo, gazetted: false }).then(employee)).gazetted).toBe(false);
    const c = await add({ name: "Clerk one", designationId: clerk, gazetted: true });
    expect((await employee(c)).gazetted).toBe(true);
    // A whole-form save without the field (an older form, an assistant) keeps it.
    await call("PUT", `/staff/employees/${c}`, { name: "Clerk one", designationId: clerk });
    expect((await employee(c)).gazetted).toBe(true);
    // Temporary staff are never gazetted.
    await call("PUT", `/staff/employees/${c}`, { name: "Clerk one", designationId: clerk, permanent: false, gazetted: true });
    expect((await employee(c)).gazetted).toBe(false);
    expect((await history()).some((h) => h.summary === "Medical Officer is a gazetted post (1 employee changed)")).toBe(true);
  });

  it("Probation declared: a date means yes; yes without a date makes no probation task and completes an open one", async () => {
    const today = (await call("GET", "/me")).json.today as string;
    const soon = (n: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return yearBefore(yearBefore(d.toISOString().slice(0, 10)));
    };
    const withDate = await add({ name: "Dated", probationDeclaredOn: "2020-01-01" });
    expect((await employee(withDate)).probationDeclared).toBe(true);
    // 2 years complete in 3 days, declared (date unknown): no task.
    const yes = await add({ name: "Yes", joinedServiceOn: soon(3), probationDeclared: true });
    const no = await add({ name: NAME, joinedServiceOn: soon(3) });
    const probation = async () => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).filter((t) => t.systemKind === "probation");
    expect((await probation()).map((t) => t.relatedId)).toEqual([no]);
    expect((await employee(yes)).probationDeclared).toBe(true);
    // Switching it to yes in the form completes the open task on the next run.
    await call("PUT", `/staff/employees/${no}`, { name: NAME, joinedServiceOn: soon(3), probationDeclared: true });
    await ensureProbationTasks(db, today);
    expect((await probation())[0]!.status).toBe("done");
    expect((await employee(no)).probationDeclaredOn).toBeNull();
    // Declared from the task's choice sets the switch; its Undo clears it.
    const later = await add({ name: "Later", joinedServiceOn: soon(2) });
    await call("POST", `/staff/employees/${later}/probation`);
    expect((await employee(later)).probationDeclared).toBe(true);
    await call("POST", `/staff/employees/${later}/probation`, { undo: true, declaredOn: today });
    expect((await employee(later)).probationDeclared).toBe(false);
    // Left out of a whole-form save: kept.
    await call("PUT", `/staff/employees/${yes}`, { name: "Yes", joinedServiceOn: soon(3) });
    expect((await employee(yes)).probationDeclared).toBe(true);
  });

  it("the Employees CSV has Gazetted and Probation declared as Yes / No", async () => {
    const mo = (await call("POST", "/staff/designations", { name: "Medical Officer" })).json.id as string;
    await call("POST", `/staff/designations/${mo}/gazetted`, { gazetted: true });
    const imp = await call("POST", "/transfer/employees/import", {
      headers: ["Name", "Designation", "Probation declared", "Gazetted"],
      rows: [
        ["Dr. Asha", "Medical Officer", "Yes", ""],
        ["Ravi", "", "no", "Yes"],
        ["Bad", "", "maybe", ""],
      ],
      firstLine: 2,
      dryRun: false,
    });
    expect(imp.json).toMatchObject({ added: 2 });
    const list = (await staff()).employees;
    expect(list.find((e) => e.name === "Dr. Asha")).toMatchObject({ probationDeclared: true, gazetted: true });
    expect(list.find((e) => e.name === "Ravi")).toMatchObject({ probationDeclared: false, gazetted: true });
    const res = await app.request("/api/transfer/employees/csv", {}, {});
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("Probation declared,Gazetted");
    expect(csv).toMatch(/Dr\. Asha,.*,Yes,Yes/);
  });

  // --- Phase 2: marking leave ---
  const leaves = async (q = "") => (await call("GET", `/leave/leaves${q}`)).json as { today: string; leaves: EmployeeLeave[] };
  const taskOf = async (id: string) => ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.id === id)!;

  it("marks leave: the days come off the balance, and a task with the non-gazetted steps is due the day they are back", async () => {
    await call("POST", "/leave/types/usual");
    const hpl = await byShort("HPL");
    const id = await add({ name: NAME });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    const made = await call("POST", "/leave/leaves", { employeeId: id, typeId: hpl.id, fromDate: "2026-11-01", toDate: "2026-11-10", days: 10, orderNo: "A1/12/2026", doneSteps: ["application"] });
    expect(made.status).toBe(201);
    expect(await balance(id, hpl.id)).toBe(30);
    const t = await taskOf(made.json.taskId);
    expect([t.title, t.dueDate, t.systemKind, t.madeBySystem, t.relatedId, t.priority]).toEqual([`Leave: ${NAME} — HPL 10 days`, "2026-11-11", "leave", true, id, "high"]);
    expect(t.checklist.map((i) => [i.text, i.done])).toEqual([
      ["Application received", true],
      ["Check leave account", false],
      ["Office proceedings", false],
      ["Update in SPARK", false],
      ["Mark in attendance", false],
      ["SB update", false],
      ["Joining report", false],
    ]);
    expect(t.notes).toContain("Order A1/12/2026.");
    // All steps done completes the task; one set back reopens it.
    await call("PATCH", `/tasks/${t.id}`, { checklist: t.checklist.map((i) => ({ ...i, done: true })) });
    expect((await taskOf(t.id)).status).toBe("done");
    await call("PATCH", `/tasks/${t.id}`, { checklist: t.checklist.map((i, k) => ({ ...i, done: k > 0 })) });
    expect((await taskOf(t.id)).status).toBe("open");
    const mine = (await leaves(`?employeeId=${id}`)).leaves;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ days: 10, status: "active", orderNo: "A1/12/2026", task: { id: t.id } });
    expect((await history()).some((h) => h.summary === `Leave of ${NAME}: Half pay leave, 10 days, 1 Nov 2026 to 10 Nov 2026`)).toBe(true);
    // Two leaves can't share a day.
    expect((await call("POST", "/leave/leaves", { employeeId: id, typeId: hpl.id, fromDate: "2026-11-10", toDate: "2026-11-12", days: 3 })).status).toBe(409);
  });

  it("gazetted officers get the gazetted steps; commuted leave takes double HPL; LND may go below zero; EOL takes nothing", async () => {
    await call("POST", "/leave/types/usual");
    const [hpl, commuted, lnd, eol] = [await byShort("HPL"), await byShort("Commuted"), await byShort("LND"), await byShort("EOL")];
    const id = await add({ name: "Dr. Rema", gazetted: true });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 20 });
    const c1 = await call("POST", "/leave/leaves", { employeeId: id, typeId: commuted.id, fromDate: "2026-02-01", toDate: "2026-02-05", days: 5 });
    expect((await taskOf(c1.json.taskId)).checklist.map((i) => i.text)).toEqual(["Leave application received", "Apply leave", "Update leave CTC", "Joining report", "Joining CTC", "AG payslip"]);
    expect(await balance(id, hpl.id)).toBe(10);
    await call("POST", "/leave/leaves", { employeeId: id, typeId: lnd.id, fromDate: "2026-03-01", toDate: "2026-03-15", days: 15 });
    expect(await balance(id, hpl.id)).toBe(-5);
    await call("POST", "/leave/leaves", { employeeId: id, typeId: eol.id, fromDate: "2026-04-01", toDate: "2026-04-30", days: 30 });
    expect(await balance(id, hpl.id)).toBe(-5);
    expect((await account(id)).used).toEqual(expect.arrayContaining([{ typeId: lnd.id, days: 15, nonMedical: 15 }, { typeId: eol.id, days: 30, nonMedical: 30 }, { typeId: commuted.id, days: 5, nonMedical: 5 }]));
    // A type with marked leave can't be removed.
    expect((await call("DELETE", `/leave/types/${eol.id}`)).status).toBe(409);
  });

  it("editing gives the old days back and takes the new; rejoining early curtails it; cancelling gives the days back", async () => {
    await call("POST", "/leave/types/usual");
    const [el, hpl] = [await byShort("EL"), await byShort("HPL")];
    const id = await add({ name: "Anitha" });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-01-01", days: 100 });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 50 });
    const made = await call("POST", "/leave/leaves", { employeeId: id, typeId: el.id, fromDate: "2026-11-01", toDate: "2026-11-20", days: 20 });
    const lid = made.json.id as string;
    expect(await balance(id, el.id)).toBe(80);
    // Rejoined on the 11th: 10 days.
    await call("PUT", `/leave/leaves/${lid}`, { typeId: el.id, fromDate: "2026-11-01", toDate: "2026-11-20", days: 10, rejoinedOn: "2026-11-11" });
    expect(await balance(id, el.id)).toBe(90);
    expect((await taskOf(made.json.taskId))).toMatchObject({ dueDate: "2026-11-11", title: "Leave: Anitha — EL 10 days" });
    expect((await history()).some((h) => h.summary === "Anitha rejoined on 11 Nov 2026 after Earned leave (10 days)")).toBe(true);
    // Changed to HPL: EL back, HPL taken.
    await call("PUT", `/leave/leaves/${lid}`, { typeId: hpl.id, fromDate: "2026-11-01", toDate: "2026-11-20", days: 10, rejoinedOn: "2026-11-11" });
    expect([await balance(id, el.id), await balance(id, hpl.id)]).toEqual([100, 40]);
    // Only the notes changed: no new lines.
    const before = (await account(id)).lines.length;
    await call("PUT", `/leave/leaves/${lid}`, { typeId: hpl.id, fromDate: "2026-11-01", toDate: "2026-11-20", days: 10, rejoinedOn: "2026-11-11", notes: "Medical" });
    expect((await account(id)).lines.length).toBe(before);
    // Cancelled: days back, the task completed, the leave kept; no more changes.
    await call("POST", `/leave/leaves/${lid}/cancel`);
    expect(await balance(id, hpl.id)).toBe(50);
    expect((await taskOf(made.json.taskId)).status).toBe("done");
    expect((await leaves(`?employeeId=${id}`)).leaves[0]!.status).toBe("cancelled");
    expect((await call("PUT", `/leave/leaves/${lid}`, { typeId: hpl.id, fromDate: "2026-11-01", toDate: "2026-11-20", days: 10 })).status).toBe(409);
    // Nothing in the account was rewritten: every line is still there.
    expect((await account(id)).lines.filter((l) => l.kind === "leave")).toHaveLength(3);
    // The dates are free again.
    expect((await call("POST", "/leave/leaves", { employeeId: id, typeId: el.id, fromDate: "2026-11-05", toDate: "2026-11-06", days: 2 })).status).toBe(201);
  });

  it("lists the leaves that matter now, and refuses temporary staff and dates in the wrong order", async () => {
    await call("POST", "/leave/types/usual");
    const eol = await byShort("EOL");
    const today = (await call("GET", "/me")).json.today as string;
    const plus = (n: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const a = await add({ name: "On leave now" });
    const b = await add({ name: "Long ago" });
    await call("POST", "/leave/leaves", { employeeId: a, typeId: eol.id, fromDate: plus(-2), toDate: plus(3), days: 6 });
    await call("POST", "/leave/leaves", { employeeId: b, typeId: eol.id, fromDate: plus(-200), toDate: plus(-190), days: 11 });
    expect((await leaves()).leaves.map((l) => l.employeeId)).toEqual([a]);
    const temp = await add({ name: "Temporary", permanent: false });
    expect((await call("POST", "/leave/leaves", { employeeId: temp, typeId: eol.id, fromDate: plus(1), toDate: plus(2), days: 2 })).status).toBe(400);
    expect((await call("POST", "/leave/leaves", { employeeId: a, typeId: eol.id, fromDate: plus(20), toDate: plus(19), days: 1 })).status).toBe(400);
  });

  // --- Phase 3: automatic credits, the leave balances file, the backup ---
  const setAuto = async (t: LeaveType, on: boolean) =>
    call("PUT", `/leave/types/${t.id}`, { name: t.name, short: t.short, hasAccount: t.hasAccount, drawsOnId: t.drawsOnId, perDay: t.perDay, mayGoNegative: t.mayGoNegative, maxBalance: t.maxBalance, serviceLimit: t.serviceLimit, medical: t.medical, yearlyDays: t.yearlyDays, fromDuty: t.fromDuty, autoCredit: on });

  it("credits HPL on each service anniversary from the day it is switched on, once a year, never before the opening balance", async () => {
    await call("POST", "/leave/types/usual");
    const hpl = await byShort("HPL");
    const a = await add({ name: NAME, joinedServiceOn: "2010-11-15" });
    const b = await add({ name: "Biju", joinedServiceOn: "2015-06-01" });
    const c = await add({ name: "Opened later", joinedServiceOn: "2012-03-10" });
    await add({ name: "Temporary", permanent: false, joinedServiceOn: "2010-01-01" });
    await call("POST", `/leave/accounts/${c}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2027-04-01", days: 100 });
    // Switched on on 30 Oct 2026 (the test's "today" is passed in below).
    expect((await setAuto(hpl, true)).status).toBe(200);
    const on = (await byShort("HPL")).creditsFrom!;
    expect(on).toBeTruthy();
    await db.update(schema.leaveTypes).set({ creditsFrom: "2026-10-30" }).where(eqId(schema.leaveTypes.id, hpl.id));
    // Nothing before 30 Oct 2026; 15 Nov 2026 for a, 1 Jun 2027 for b; c's 10 Mar 2027 is before its opening date.
    expect(await ensureLeaveCredits(db, "2026-11-14")).toBe(0);
    expect(await ensureLeaveCredits(db, "2026-11-15")).toBe(1);
    expect(await ensureLeaveCredits(db, "2026-11-20")).toBe(0);
    expect(await balance(a, hpl.id)).toBe(20);
    expect((await account(a)).lines[0]).toMatchObject({ kind: "credit", creditFor: "2026", onDate: "2026-11-15", note: "Service anniversary 15 Nov 2026 (16 years of service)" });
    // A year already credited by Credit now isn't credited again.
    await call("POST", `/leave/types/${hpl.id}/credit`, { creditFor: "2027", onDate: "2027-01-01", days: 20 });
    expect(await ensureLeaveCredits(db, "2027-12-31")).toBe(0);
    expect([await balance(a, hpl.id), await balance(b, hpl.id), await balance(c, hpl.id)]).toEqual([40, 20, 120]);
    expect((await history()).some((h) => h.summary === `Leave account of ${NAME}: Credit +20 HPL for 2026 (service anniversary, automatic)`)).toBe(true);
    // Switched off: nothing more.
    await setAuto(await byShort("HPL"), false);
    expect((await byShort("HPL")).creditsFrom).toBeNull();
    expect(await ensureLeaveCredits(db, "2028-12-31")).toBe(0);
  });

  it("credits EL as 1/11 of the days on duty, only when probation is declared, leaving out leave marked", async () => {
    await call("POST", "/leave/types/usual");
    const [el, eol] = [await byShort("EL"), await byShort("EOL")];
    const a = await add({ name: "Declared", joinedServiceOn: "2020-07-01", probationDeclared: true });
    const b = await add({ name: "Not declared", joinedServiceOn: "2024-07-01", probationDeclared: false });
    await call("POST", `/leave/accounts/${a}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-01-01", days: 290 });
    // 22 days of EOL inside the service year 1 Jul 2026 – 30 Jun 2027.
    await call("POST", "/leave/leaves", { employeeId: a, typeId: eol.id, fromDate: "2026-09-01", toDate: "2026-09-22", days: 22 });
    await setAuto(el, true);
    await db.update(schema.leaveTypes).set({ creditsFrom: "2026-01-01" }).where(eqId(schema.leaveTypes.id, el.id));
    // 1 Jul 2026: the year since the opening (1 Jan – 30 Jun 2026: 181 days) → 16 days; 290 + 16 = 306, so 6 lapse.
    expect(await ensureLeaveCredits(db, "2026-07-01")).toBe(1);
    expect(await balance(a, el.id)).toBe(300);
    const credit = (await account(a)).lines.find((l) => l.kind === "credit")!;
    expect(credit).toMatchObject({ days: 16, creditFor: "2026", note: "Service anniversary 1 Jul 2026: 181 days, 0 on leave → 181 on duty ÷ 11" });
    // 1 Jul 2027: 365 days, 22 on leave → 343 ÷ 11 = 31.
    await call("POST", `/leave/accounts/${a}/lines`, { typeId: el.id, kind: "adjust", onDate: "2027-01-01", days: -100 });
    expect(await ensureLeaveCredits(db, "2027-07-01")).toBe(1);
    expect(await balance(a, el.id)).toBe(231);
    expect((await account(a)).balances.length).toBeGreaterThan(0);
    expect((await account(b)).lines).toEqual([]);
  });

  it("the leave balances file: opening balances first, then adjustments to the balance given; and the export", async () => {
    await call("POST", "/leave/types/usual");
    const [el, hpl] = [await byShort("EL"), await byShort("HPL")];
    const a = await add({ name: NAME, pen: "765432" });
    await add({ name: "Biju" });
    const imp = (rows: string[][], dryRun = false) => call("POST", "/transfer/leave/import", { headers: ["PEN", "Name", "Leave", "Balance", "As on"], rows, firstLine: 2, dryRun });
    const first = await imp([
      ["765432", "", "EL", "124.5", "01/10/2026"],
      ["", NAME, "Half pay leave", "46", "2026-10-01"],
      ["", "Biju", "EOL", "5", "2026-10-01"],
      ["", "Nobody", "EL", "5", "2026-10-01"],
      ["", "Biju", "EL", "abc", "2026-10-01"],
    ]);
    expect(first.json).toMatchObject({ added: 2, updated: 0 });
    expect(first.json.problems.map((p: { row: number }) => p.row)).toEqual([4, 5, 6]);
    expect([await balance(a, el.id), await balance(a, hpl.id)]).toEqual([124.5, 46]);
    // Again with a new HPL figure: an adjustment; the same EL is skipped.
    const again = await imp([
      ["765432", "", "EL", "124.5", "2026-10-30"],
      ["765432", "", "HPL", "40", "2026-10-30"],
    ]);
    expect(again.json).toMatchObject({ added: 0, updated: 1, skipped: 1 });
    expect(await balance(a, hpl.id)).toBe(40);
    expect((await account(a)).lines.map((l) => l.kind).sort()).toEqual(["adjust", "opening", "opening"]);
    expect((await history()).some((h) => h.summary === `Leave account of ${NAME}: Adjustment -6 HPL (from the leave balances file)`)).toBe(true);
    const csv = await (await app.request("/api/transfer/leave/csv", {}, {})).text();
    expect(csv.split("\r\n")[0]).toContain("PEN,Name,Leave,Balance,As on");
    // The name has a comma, so it is quoted.
    expect(csv).toContain(`765432,"${NAME}",EL,124.5,`);
    expect(csv).toContain("Biju,HPL,0,");
  });

  it("the backup brings leave types, leaves and accounts back into an empty WorkDesk", async () => {
    await call("POST", "/leave/types/usual");
    const [hpl, commuted] = [await byShort("HPL"), await byShort("Commuted")];
    const a = await add({ name: NAME });
    await call("POST", `/leave/accounts/${a}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    await call("POST", "/leave/leaves", { employeeId: a, typeId: commuted.id, fromDate: "2026-11-01", toDate: "2026-11-05", days: 5 });
    const backup = (await call("GET", "/transfer/backup")).json as { tables: Record<string, unknown[]> };
    expect(backup.tables.leaveTypes).toHaveLength(12);
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
    // This WorkDesk already added the usual leaves (unused): they make room for the backup's.
    await call("POST", "/leave/types/usual");
    for (const t of BACKUP_TABLES) await call("POST", "/transfer/backup", { table: t, rows: backup.tables[t] ?? [] });
    const list = await types();
    expect(list).toHaveLength(12);
    expect(list.find((t) => t.short === "Commuted")!.drawsOnId).toBe(hpl.id);
    expect(await balance(a, hpl.id)).toBe(30);
    expect((await call("GET", `/leave/leaves?employeeId=${a}`)).json.leaves).toHaveLength(1);
  });

  // --- Phase 4: EOL moves the increment and probation; surrender of earned leave ---

  it("EOL moves the next increment and the open probation task by its days when asked, with Undo", async () => {
    await call("POST", "/leave/types/usual");
    const [eol, hpl] = [await byShort("EOL"), await byShort("HPL")];
    expect(eol.delaysIncrement).toBe(true);
    expect(hpl.delaysIncrement).toBe(false);
    const today = (await call("GET", "/me")).json.today as string;
    // 2 years of service complete in 3 days: the probation task is there.
    const joined = yearBefore(yearBefore(shift(today, 3)));
    const id = await add({ name: NAME, joinedServiceOn: joined, nextIncrementOn: "2027-06-01" });
    const probationTask = ((await call("GET", "/tasks?view=any")).json.tasks as Task[]).find((t) => t.systemKind === "probation" && t.relatedId === id)!;
    const made = await call("POST", "/leave/leaves", { employeeId: id, typeId: eol.id, fromDate: "2026-12-01", toDate: "2026-12-20", days: 19.5, postpone: { increment: true, probation: true } });
    expect(made.json.postponed).toEqual({ increment: { from: "2027-06-01", to: "2027-06-21" }, probation: { taskId: probationTask.id, from: shift(today, 3), to: shift(today, 23) } });
    expect((await employee(id)).nextIncrementOn).toBe("2027-06-21");
    expect((await taskOf(probationTask.id)).dueDate).toBe(shift(today, 23));
    expect((await history()).some((h) => h.summary === `Next increment of ${NAME} moved from 1 Jun 2027 to 21 Jun 2027 (20 days of Extraordinary leave)`)).toBe(true);
    // Undo puts both back (only while they are still the moved dates).
    await call("POST", `/leave/leaves/${made.json.id}/postpone/undo`, made.json.postponed);
    expect((await employee(id)).nextIncrementOn).toBe("2027-06-01");
    expect((await taskOf(probationTask.id)).dueDate).toBe(shift(today, 3));
    // Not asked, or a leave that counts (HPL): nothing moves.
    const other = await call("POST", "/leave/leaves", { employeeId: id, typeId: eol.id, fromDate: "2027-01-10", toDate: "2027-01-12", days: 3 });
    expect(other.json.postponed).toEqual({});
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    const h = await call("POST", "/leave/leaves", { employeeId: id, typeId: hpl.id, fromDate: "2027-02-01", toDate: "2027-02-05", days: 5, postpone: { increment: true, probation: true } });
    expect(h.json.postponed).toEqual({});
    expect((await employee(id)).nextIncrementOn).toBe("2027-06-01");
  });

  it("surrender takes the days off the balance and makes a task with the surrender steps", async () => {
    await call("POST", "/leave/types/usual");
    const [el, eol] = [await byShort("EL"), await byShort("EOL")];
    const id = await add({ name: NAME });
    await call("POST", `/leave/accounts/${id}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-01-01", days: 120 });
    const r = await call("POST", `/leave/accounts/${id}/surrender`, { typeId: el.id, days: 30, onDate: "2026-11-01", orderNo: "B2/45/2026", doneSteps: ["application"] });
    expect(r.status).toBe(201);
    expect(await balance(id, el.id)).toBe(90);
    expect((await account(id)).lines[0]).toMatchObject({ kind: "surrender", days: -30, note: "Order B2/45/2026" });
    const t = await taskOf(r.json.taskId);
    expect([t.title, t.dueDate, t.systemKind]).toEqual([`Leave surrender: ${NAME} — EL 30 days`, "2026-11-08", "leave"]);
    expect(t.checklist.map((i) => [i.text, i.done])).toEqual([
      ["Surrender application received", true],
      ["Sanction order", false],
      ["Prepare bill", false],
      ["Update in SPARK", false],
      ["SB update", false],
    ]);
    await call("PATCH", `/tasks/${t.id}`, { checklist: t.checklist.map((i) => ({ ...i, done: true })) });
    expect((await taskOf(t.id)).status).toBe("done");
    expect((await history()).some((h) => h.summary === `Leave account of ${NAME}: Surrendered 30 EL (order B2/45/2026)`)).toBe(true);
    expect((await call("POST", `/leave/accounts/${id}/surrender`, { typeId: eol.id, days: 5, onDate: "2026-11-01" })).status).toBe(400);
    // At retirement (terminal surrender): marked on the line.
    const end = await call("POST", `/leave/accounts/${id}/surrender`, { typeId: el.id, days: 60, onDate: "2026-12-31", terminal: true });
    expect((await account(id)).lines[0]).toMatchObject({ kind: "surrender", days: -60, terminal: true, note: "Terminal surrender (retirement)" });
    expect((await taskOf(end.json.taskId)).notes).toContain("Terminal surrender of 60 days of Earned leave");
  });
});

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
