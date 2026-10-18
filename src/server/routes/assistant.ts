// Settings › Assistant (MCP server, user request 2026-10-18): the address assistants connect to, the assistants
// connected now (with Disconnect) and the assistant log — every tool call an assistant made, kept apart from
// History (user's choice 2026-10-18: "keep a separate log").
import { Hono } from "hono";
import { and, desc, eq, lt, min, max } from "drizzle-orm";
import type { AppEnv } from "../app";
import { assistantLog, events, mcpClients, mcpTokens } from "../db/schema";
import { MCP_PATH, publicBase } from "../mcp/oauth";
import { TOOLS } from "../mcp/tools";
import type { AssistantInfo } from "../../shared/types";

const PAGE = 50;

export const assistantRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const before = c.req.query("before");
    const [connections, log] = await Promise.all([
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
        .where(and(eq(assistantLog.userId, userId), before ? lt(assistantLog.createdAt, new Date(before)) : undefined))
        .orderBy(desc(assistantLog.createdAt))
        .limit(PAGE),
    ]);
    return c.json({
      url: `${publicBase(c)}${MCP_PATH}`,
      connections: connections.map((x) => ({ clientId: x.clientId, name: x.name, connectedAt: x.connectedAt?.toISOString() ?? null, lastUsedAt: x.lastUsedAt?.toISOString() ?? null })),
      log: log.map((l) => ({ id: l.id, clientName: l.clientName, tool: l.tool, title: TOOLS.find((t) => t.name === l.tool)?.title ?? l.tool, args: l.args, ok: l.ok, message: l.message, createdAt: l.createdAt.toISOString() })),
      more: log.length === PAGE,
    } satisfies AssistantInfo);
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
