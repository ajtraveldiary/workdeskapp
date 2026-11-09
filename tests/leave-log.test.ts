// Leave log (user request 2026-11-09): CL, half day CL and CH from the register and leave from the Leave page, oldest
// first; CL / CH days in a row (holidays between them too) as one line; offs, H / SS, absent and OD left out, and
// cancelled leave too.
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { markRuns, type LeaveLog } from "../src/shared/leaveLog";
import type { LeaveType } from "../src/shared/types";

const NAME = "2026-27 സാമ്പത്തിക വർഷത്തെ ജൂനിയർ ഹെൽത്ത് ഇൻസ്‌പെക്ടർ ശ്രീമതി അനിതാകുമാരി രാധാകൃഷ്ണൻ";

describe("leave log", () => {
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const add = async (body: Record<string, unknown>) => (await call("POST", "/staff/employees", body)).json.id as string;
  const mark = (employeeId: string, dates: string[], m: string) => call("POST", "/attendance/mark", { cells: dates.map((date) => ({ employeeId, date })), mark: m });

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    const db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("joins CL / CH days in a row, across days off not marked", () => {
    const off = (d: string) => d === "2026-11-14" || d === "2026-11-15";
    const runs = markRuns(
      [
        { date: "2026-11-13", mark: "cl", chHoliday: null },
        { date: "2026-11-16", mark: "cl", chHoliday: null },
        { date: "2026-11-18", mark: "cl", chHoliday: null },
        { date: "2026-11-19", mark: "cl_half", chHoliday: null },
        { date: "2026-11-20", mark: "cl_half", chHoliday: null },
      ],
      off,
    );
    expect(runs.map((r) => [r.mark, r.from, r.to, r.days.length])).toEqual([
      ["cl", "2026-11-13", "2026-11-16", 2],
      ["cl", "2026-11-18", "2026-11-18", 1],
      ["cl_half", "2026-11-19", "2026-11-19", 1],
      ["cl_half", "2026-11-20", "2026-11-20", 1],
    ]);
  });

  it("lists CL, half day CL, CH and Leave page leave in date order, and nothing else", async () => {
    const a = await add({ name: NAME });
    const b = await add({ name: "Biju", offDay: "weekly" });
    await call("POST", "/attendance/holidays", { date: "2026-10-02", name: "Gandhi Jayanthi" });
    // CL Fri 13 and Mon 16 Nov (the second Saturday and Sunday between): one line of 2 days. ½ CL on 20 Nov.
    await mark(a, ["2026-11-13", "2026-11-16"], "cl");
    await mark(a, ["2026-11-20"], "cl_half");
    // Biju worked Gandhi Jayanthi and took the CH on 5 Oct; an off, H, absent and OD are not leave.
    await mark(b, ["2026-10-02"], "present");
    await call("POST", "/attendance/ch", { items: [{ employeeId: b, date: "2026-10-05", holiday: "2026-10-02" }] });
    await mark(b, ["2026-10-06"], "off");
    await mark(b, ["2026-10-07"], "absent");
    await mark(b, ["2026-10-08"], "od");
    // EL on the Leave page, and a cancelled HPL.
    const types = (await call("GET", "/leave/types")).json.types as LeaveType[];
    const el = types.find((t) => t.ksrKey === "el")!;
    const hpl = types.find((t) => t.ksrKey === "hpl")!;
    await call("POST", `/leave/accounts/${a}/lines`, { typeId: el.id, kind: "opening", onDate: "2026-01-01", days: 60 });
    await call("POST", `/leave/accounts/${a}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    await call("POST", "/leave/leaves", { employeeId: a, typeId: el.id, fromDate: "2026-09-01", toDate: "2026-09-10", days: 10, orderNo: "A1/123/2026" });
    const gone = (await call("POST", "/leave/leaves", { employeeId: a, typeId: hpl.id, fromDate: "2026-12-01", toDate: "2026-12-02", days: 2 })).json.id as string;
    await call("POST", `/leave/leaves/${gone}/cancel`);

    const log = (await call("GET", "/attendance/leave-log?from=2026-01-01&to=2026-12-31")).json as LeaveLog;
    expect(log.entries.map((e) => [e.type, e.from, e.to, e.days])).toEqual([
      ["EL", "2026-09-01", "2026-09-10", 10],
      ["CH", "2026-10-05", "2026-10-05", 1],
      ["CL", "2026-11-13", "2026-11-16", 2],
      ["½ CL", "2026-11-20", "2026-11-20", 0.5],
    ]);
    expect(log.entries[0]).toMatchObject({ kind: "leave", filter: `leave:${el.id}`, employeeId: a, details: "Order A1/123/2026" });
    expect(log.entries[1]).toMatchObject({ filter: "ch", employeeId: b, details: "For the holiday worked on 02.10.2026 (Gandhi Jayanthi)" });
    expect(log.entries[2]!.details).toBe("13.11, 16.11");
    expect(log.people.map((p) => p.name)).toEqual(["Biju", NAME].sort((x, y) => x.localeCompare(y)));
    expect(log.types.slice(0, 3).map((t) => t.filter)).toEqual(["cl", "cl_half", "ch"]);
    expect(log.types.some((t) => t.filter === `leave:${el.id}`)).toBe(true);
    // A period: only what falls in it (a leave overlapping it counts).
    const oct = (await call("GET", "/attendance/leave-log?from=2026-09-05&to=2026-10-31")).json as LeaveLog;
    expect(oct.entries.map((e) => e.type)).toEqual(["EL", "CH"]);
    expect((await call("GET", "/attendance/leave-log?from=2026-10-31&to=2026-10-01")).status).toBe(400);
  });
});
