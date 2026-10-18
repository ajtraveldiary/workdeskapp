// Settings › Assistant (MCP server, user request 2026-10-18): the address assistants connect to, the assistants
// connected now (with Disconnect) and the assistant log — every tool call an assistant made, kept apart from
// History (user's choice 2026-10-18: "keep a separate log").
import { Hono } from "hono";
import { and, desc, eq, lt, min, max } from "drizzle-orm";
import type { AppEnv } from "../app";
import { assistantLog, events, mcpClients, mcpTokens, users } from "../db/schema";
import { assistantSettingsInput } from "../../shared/schemas";
import { MCP_PATH, publicBase } from "../mcp/oauth";
import { ALL_TOOLS } from "../mcp/server";
import type { AssistantInfo } from "../../shared/types";

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
