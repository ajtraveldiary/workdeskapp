// Settings › Assistant (MCP server, user request 2026-10-18): the address assistants connect to, the assistants
// connected now (with Disconnect) and the assistant log — every tool call an assistant made, kept apart from
// History (user's choice 2026-10-18: "keep a separate log").
import { Hono } from "hono";
import { and, count, desc, eq, gt, lt, min, max } from "drizzle-orm";
import type { AppEnv } from "../app";
import { assistantLog, events, mcpClients, mcpTokens, users } from "../db/schema";
import { assistantSettingsInput } from "../../shared/schemas";
import { MCP_PATH, publicBase } from "../mcp/oauth";
import { ALL_TOOLS } from "../mcp/server";
import type { AssistantInfo, AssistantUnseen } from "../../shared/types";
import { toCsv } from "../../shared/transfer";
import { timezone } from "../env";

const PAGE = 50;

export const assistantRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const before = c.req.query("before");
    const onlyChanges = c.req.query("changes") === "1";
    const [[settings], connections, log] = await Promise.all([
      db.select({ allowChanges: users.assistantChanges, perHour: users.assistantPerHour, allowStaff: users.assistantStaff }).from(users).where(eq(users.id, userId)),
      db
        .select({ clientId: mcpTokens.clientId, name: mcpClients.name, connectedAt: min(mcpTokens.createdAt), lastUsedAt: max(mcpTokens.lastUsedAt) })
        .from(mcpTokens)
        .innerJoin(mcpClients, eq(mcpClients.id, mcpTokens.clientId))
        .where(eq(mcpTokens.userId, userId))
        .groupBy(mcpTokens.clientId, mcpClients.name)
        .orderBy(mcpClients.name),
      db
        .select()
        .from(assistantLog)
        .where(and(eq(assistantLog.userId, userId), before ? lt(assistantLog.createdAt, new Date(before)) : undefined, onlyChanges ? eq(assistantLog.change, true) : undefined))
        .orderBy(desc(assistantLog.createdAt))
        .limit(PAGE),
    ]);
    return c.json({
      url: `${publicBase(c)}${MCP_PATH}`,
      allowChanges: settings?.allowChanges ?? false,
      perHour: settings?.perHour ?? 30,
      allowStaff: settings?.allowStaff ?? false,
      connections: connections.map((x) => ({ clientId: x.clientId, name: x.name, connectedAt: x.connectedAt?.toISOString() ?? null, lastUsedAt: x.lastUsedAt?.toISOString() ?? null })),
      log: log.map((l) => ({ id: l.id, clientName: l.clientName, tool: l.tool, title: ALL_TOOLS.find((t) => t.name === l.tool)?.title ?? l.tool, args: l.args, ok: l.ok, message: l.message, change: l.change, touched: l.touched, createdAt: l.createdAt.toISOString() })),
      more: log.length === PAGE,
    } satisfies AssistantInfo);
  })

  // The bell (Phase 5, user request 2026-10-19): changes assistants made since the user last looked, newest first.
  .get("/unseen", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const [u] = await db.select({ seenAt: users.assistantSeenAt }).from(users).where(eq(users.id, userId));
    const where = and(eq(assistantLog.userId, userId), eq(assistantLog.change, true), eq(assistantLog.ok, true), u?.seenAt ? gt(assistantLog.createdAt, u.seenAt) : undefined);
    const [[n], rows] = await Promise.all([
      db.select({ n: count() }).from(assistantLog).where(where),
      db.select().from(assistantLog).where(where).orderBy(desc(assistantLog.createdAt)).limit(5),
    ]);
    return c.json({
      count: Number(n?.n ?? 0),
      latest: rows.map((l) => ({ id: l.id, clientName: l.clientName, title: ALL_TOOLS.find((t) => t.name === l.tool)?.title ?? l.tool, touched: l.touched, createdAt: l.createdAt.toISOString() })),
    } satisfies AssistantUnseen);
  })
  // Looked at them (opening Settings › Assistant, or tapping one in the bell).
  .post("/seen", async (c) => {
    await c.get("db").update(users).set({ assistantSeenAt: new Date() }).where(eq(users.id, c.get("userId")));
    return c.json({ ok: true });
  })
  // The assistant log as a spreadsheet (Phase 5): everything kept (a year), or only changes (?changes=1).
  .get("/log.csv", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const rows = await db
      .select()
      .from(assistantLog)
      .where(and(eq(assistantLog.userId, userId), c.req.query("changes") === "1" ? eq(assistantLog.change, true) : undefined))
      .orderBy(desc(assistantLog.createdAt))
      .limit(20_000);
    const when = new Intl.DateTimeFormat("en-CA", { timeZone: timezone(c.env), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const csv = toCsv([
      ["Time", "Assistant", "What", "Tool", "Change", "Result", "Message", "What changed", "Request"],
      ...rows.map((l) => [
        when.format(l.createdAt).replace(",", ""),
        l.clientName,
        ALL_TOOLS.find((t) => t.name === l.tool)?.title ?? l.tool,
        l.tool,
        l.change ? "Yes" : "No",
        l.ok ? "OK" : l.change ? "Refused" : "Error",
        l.message,
        (l.touched ?? []).map((t) => `${t.kind}: ${t.title}`).join("; "),
        JSON.stringify(l.args),
      ]),
    ]);
    return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" });
  })

  // Allow changes and the hourly limit (Phase 3, user request 2026-10-18); each change of them goes in History.
  .put("/settings", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const input = assistantSettingsInput.parse(await c.req.json());
    const [before] = await db.select({ allowChanges: users.assistantChanges, perHour: users.assistantPerHour, allowStaff: users.assistantStaff }).from(users).where(eq(users.id, userId));
    await db.update(users).set({ assistantChanges: input.allowChanges, assistantPerHour: input.perHour, assistantStaff: input.allowStaff }).where(eq(users.id, userId));
    const notes = [
      before?.allowChanges !== input.allowChanges && (input.allowChanges ? "Assistants may now make changes" : "Assistants can no longer make changes"),
      before?.perHour !== input.perHour && `Assistant changes limited to ${input.perHour} an hour`,
      before?.allowStaff !== input.allowStaff && (input.allowStaff ? "Assistants may now make staff actions" : "Assistants can no longer make staff actions"),
    ].filter((x): x is string => !!x);
    if (notes.length) await db.insert(events).values({ userId, entityType: "sync", action: "settings.assistant_changes", summary: notes.join("; ") });
    return c.json({ ok: true });
  })

  // Disconnect: its tokens stop working at once; it must ask the user again to come back.
  .delete("/connections/:clientId", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const clientId = c.req.param("clientId");
    const gone = await db.delete(mcpTokens).where(and(eq(mcpTokens.userId, userId), eq(mcpTokens.clientId, clientId))).returning({ id: mcpTokens.id });
    if (gone.length) {
      const [cl] = await db.select({ name: mcpClients.name }).from(mcpClients).where(eq(mcpClients.id, clientId));
      await db.insert(events).values({ userId, entityType: "sync", action: "settings.assistant_disconnected", summary: `Disconnected the assistant ${cl?.name ?? ""}`.trim() });
    }
    return c.json({ ok: true });
  });
