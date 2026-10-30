// Leave, phase 1 (user request 2026-10-30, docs/LEAVE_PLAN.md): leave types, each permanent employee's leave
// account (opening balance, credits, adjustments, lapse above the most that can be kept), "Credit now" once per
// year, the Gazetted switch (filled from the designation) and the Probation declared switch (no probation task
// while it is yes).
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { ensureProbationTasks } from "../src/server/lib/probation";
import { yearBefore } from "../src/shared/staff";
import type { AuditEvent, Employee, LeaveAccount, LeaveType, StaffList, Task } from "../src/shared/types";

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

  it("adds the usual leaves once, with commuted leave and LND taking from HPL", async () => {
    expect((await call("POST", "/leave/types/usual")).json.added).toBe(7);
    expect((await call("POST", "/leave/types/usual")).json.added).toBe(0);
    const list = await types();
    const hpl = list.find((t) => t.short === "HPL")!;
    expect(list.map((t) => t.short)).toEqual(["EL", "HPL", "Commuted", "LND", "EOL", "ML", "PL"]);
    expect(hpl).toMatchObject({ hasAccount: true, yearlyDays: 20, drawsOnId: null });
    expect(list.find((t) => t.short === "EL")).toMatchObject({ hasAccount: true, fromDuty: true, maxBalance: 300 });
    expect(list.find((t) => t.short === "Commuted")).toMatchObject({ hasAccount: false, drawsOnId: hpl.id, perDay: 2, medical: true });
    expect(list.find((t) => t.short === "LND")).toMatchObject({ hasAccount: false, drawsOnId: hpl.id, mayGoNegative: true, serviceLimit: 360 });
    expect(list.find((t) => t.short === "EOL")).toMatchObject({ hasAccount: false, drawsOnId: null });
    expect((await history()).some((h) => h.summary === "Added 7 usual leave types")).toBe(true);
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
});
