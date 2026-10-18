// Sign-in for assistants (MCP server, user request 2026-10-18; docs/MCP_PLAN.md). WorkDesk is its own OAuth 2.1
// authorization server for the MCP endpoint: discovery documents (RFC 9728 protected resource, RFC 8414
// authorization server), dynamic client registration (RFC 7591; ChatGPT, Gemini) and Client ID Metadata Documents
// (the client id is the https address of its metadata; ChatGPT), authorization code + PKCE (S256 only), refresh
// tokens replaced on every use, and revocation. The person approves on a consent page after the normal Google
// sign-in; codes and tokens are stored hashed.
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, gt, lt } from "drizzle-orm";
import type { AppEnv } from "../app";
import type { DB } from "../db";
import { assistantLog, events, mcpClients, mcpCodes, mcpTokens, users } from "../db/schema";
import { randomToken, signPayload, verifyPayload } from "../lib/crypto";

export const MCP_PATH = "/api/mcp";
export const SCOPE = "workdesk";
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 60;
const CODE_MINUTES = 10;

// The public address of this WorkDesk (APP_URL in production; the request's own origin locally and in tests).
export const publicBase = (c: Context<AppEnv>) => (c.env.APP_URL ? c.env.APP_URL.replace(/\/$/, "") : new URL(c.req.url).origin);

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export const hashToken = async (s: string) => [...(await sha256(s))].map((b) => b.toString(16).padStart(2, "0")).join("");
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// --- Discovery ---

export function protectedResourceMetadata(c: Context<AppEnv>) {
  const base = publicBase(c);
  return { resource: `${base}${MCP_PATH}`, authorization_servers: [base], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "WorkDesk" };
}

export function authorizationServerMetadata(c: Context<AppEnv>) {
  const base = publicBase(c);
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true,
  };
}

// --- Clients ---

const okRedirect = (uri: string) => {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
};

// The client named in a request: one that registered here, or (an https client id) its metadata document, fetched
// and checked each time it signs in.
async function findClient(db: DB, clientId: string): Promise<{ id: string; name: string; redirectUris: string[] } | null> {
  if (/^https:\/\//.test(clientId)) {
    try {
      const res = await fetch(clientId, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const text = await res.text();
      if (text.length > 20_000) return null;
      const doc = JSON.parse(text) as { client_id?: string; client_name?: string; redirect_uris?: unknown };
      if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
      const redirectUris = doc.redirect_uris.filter((u): u is string => typeof u === "string" && okRedirect(u));
      const name = String(doc.client_name ?? new URL(clientId).hostname).slice(0, 100);
      await db
        .insert(mcpClients)
        .values({ id: clientId, name, redirectUris, kind: "metadata" })
        .onConflictDoUpdate({ target: mcpClients.id, set: { name, redirectUris } });
      return { id: clientId, name, redirectUris };
    } catch {
      return null;
    }
  }
  const [cl] = await db.select().from(mcpClients).where(eq(mcpClients.id, clientId));
  return cl ? { id: cl.id, name: cl.name, redirectUris: cl.redirectUris } : null;
}

// --- Who is signed in to WorkDesk in this browser (the same check as the app's) ---

export async function sessionUserId(c: Context<AppEnv>, demo: () => Promise<string>): Promise<string | null> {
  if (c.get("demo")) return demo();
  const token = getCookie(c, "wd_session");
  const secret = c.env.SESSION_SECRET;
  if (!token || !secret) return null;
  const s = await verifyPayload<{ uid: string; exp: number }>(token, secret);
  if (!s || s.exp < Date.now()) return null;
  const [u] = await c.get("db").select({ id: users.id }).from(users).where(eq(users.id, s.uid));
  return u?.id ?? null;
}

// --- Tokens ---

async function issueTokens(db: DB, userId: string, clientId: string, scope: string) {
  const access = `wda_${randomToken(32)}`;
  const refresh = `wdr_${randomToken(32)}`;
  const now = Date.now();
  await db.insert(mcpTokens).values([
    { userId, clientId, kind: "access", tokenHash: await hashToken(access), scope, expiresAt: new Date(now + ACCESS_SECONDS * 1000) },
    { userId, clientId, kind: "refresh", tokenHash: await hashToken(refresh), scope, expiresAt: new Date(now + REFRESH_DAYS * 86400_000) },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope };
}

// The user and assistant behind an MCP request's bearer token (null: missing, unknown, expired or revoked).
export async function bearerUser(db: DB, header: string | undefined) {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) return null;
  const [t] = await db
    .select({ id: mcpTokens.id, userId: mcpTokens.userId, clientId: mcpTokens.clientId, clientName: mcpClients.name, scope: mcpTokens.scope, lastUsedAt: mcpTokens.lastUsedAt })
    .from(mcpTokens)
    .innerJoin(mcpClients, eq(mcpClients.id, mcpTokens.clientId))
    .where(and(eq(mcpTokens.tokenHash, await hashToken(m[1]!)), eq(mcpTokens.kind, "access"), gt(mcpTokens.expiresAt, new Date())));
  if (!t) return null;
  // "Last used" for Settings › Assistant, at most once a minute.
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) await db.update(mcpTokens).set({ lastUsedAt: new Date() }).where(eq(mcpTokens.id, t.id));
  return t;
}

// Keep the assistant's data tidy: expired codes and tokens, and log rows older than a year (run by maintain).
export async function cleanAssistantData(db: DB) {
  const now = new Date();
  await db.delete(mcpCodes).where(lt(mcpCodes.expiresAt, now));
  await db.delete(mcpTokens).where(lt(mcpTokens.expiresAt, now));
  await db.delete(assistantLog).where(lt(assistantLog.createdAt, new Date(now.getTime() - 365 * 86400_000)));
}

// --- Pages ---

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · WorkDesk</title><style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#14171c;--muted:#5c6470;--line:#e3e6ea;--brand:#1e6bff}
@media (prefers-color-scheme:dark){:root{--bg:#1e1f20;--card:#2a2b2d;--ink:#eceef1;--muted:#a3a9b3;--line:#3a3c40;--brand:#5b93ff}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;margin:8vh auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
h1{font-size:1.25rem;margin:0 0 6px}p,li{color:var(--muted);font-size:.95rem}ul{padding-left:1.2rem;margin:12px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button{font:inherit;border-radius:10px;padding:10px 18px;min-height:44px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button.primary{background:var(--brand);border-color:var(--brand);color:#fff}button:active{transform:scale(.97)}b{color:var(--ink)}</style></head>
<body><main><div class="card">${body}</div></main></body></html>`;

const errorPage = (c: Context<AppEnv>, message: string) => c.html(page("Can't connect", `<h1>Can't connect this assistant</h1><p>${esc(message)}</p>`), 400);

// --- Routes (mounted at /api/oauth; before the app's sign-in check, which they do themselves) ---

export function oauthRoutes(demoUser: (c: Context<AppEnv>) => Promise<string>) {
  return (
    new Hono<AppEnv>()
      // Dynamic client registration: public clients (no secret), PKCE required.
      .post("/register", async (c) => {
        const body = (await c.req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
        const uris = Array.isArray(body?.redirect_uris) ? body!.redirect_uris.filter((u): u is string => typeof u === "string") : [];
        if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) return c.json({ error: "invalid_redirect_uri", error_description: "Give https redirect addresses" }, 400);
        const id = `wdc_${randomToken(18)}`;
        const name = typeof body?.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "Assistant";
        await c.get("db").insert(mcpClients).values({ id, name, redirectUris: uris, kind: "registered" });
        return c.json(
          {
            client_id: id,
            client_name: name,
            redirect_uris: uris,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_id_issued_at: Math.floor(Date.now() / 1000),
          },
          201,
        );
      })

      // The consent page (after the normal Google sign-in when needed).
      .get("/authorize", async (c) => {
        const q = c.req.query();
        if (q.response_type !== "code") return errorPage(c, "Only the authorization code flow is supported.");
        if (!q.code_challenge || q.code_challenge_method !== "S256") return errorPage(c, "The assistant must use PKCE (S256).");
        const client = q.client_id ? await findClient(c.get("db"), q.client_id) : null;
        if (!client) return errorPage(c, "This assistant isn't registered with WorkDesk. Add it again from the assistant.");
        if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) return errorPage(c, "The assistant's return address doesn't match its registration.");
        const userId = await sessionUserId(c, () => demoUser(c));
        if (!userId) {
          const back = new URL(c.req.url);
          return c.redirect(`/api/auth/google?return=${encodeURIComponent(back.pathname + back.search)}`);
        }
        const secret = c.env.SESSION_SECRET ?? "workdesk-demo";
        const csrf = await signPayload({ uid: userId, exp: Date.now() + CODE_MINUTES * 60_000, purpose: "mcp-consent" }, secret);
        const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "scope", "resource"]
          .map((k) => (q[k] !== undefined ? `<input type="hidden" name="${k}" value="${esc(q[k]!)}">` : ""))
          .join("");
        return c.html(
          page(
            "Connect assistant",
            `<h1>Connect ${esc(client.name)} to WorkDesk?</h1>
<p><b>${esc(client.name)}</b> (${esc(new URL(q.redirect_uri).host)}) will be able to <b>read everything in your WorkDesk</b> when you ask it to:</p>
<ul><li>emails and their attachments, tasks, reminders, events, calendar</li><li>employees with all their details, joining and relieving</li><li>registers, the file register, History and settings</li><li>website logins without their passwords — passwords are never shared</li></ul>
<p>It can change things (tasks, emails, register entries, events) only if you switch on Allow changes in Settings › Assistant, and it asks you first; it can never delete anything. Every request it makes is listed there, where you can disconnect it.</p>
<form method="post" class="row">${hidden}<input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="primary" name="decision" value="allow" type="submit">Allow</button><button name="decision" value="deny" type="submit">Cancel</button></form>`,
          ),
        );
      })

      .post("/authorize", async (c) => {
        const f = (await c.req.parseBody()) as Record<string, string>;
        const userId = await sessionUserId(c, () => demoUser(c));
        const secret = c.env.SESSION_SECRET ?? "workdesk-demo";
        const csrf = f.csrf ? await verifyPayload<{ uid: string; exp: number; purpose: string }>(f.csrf, secret) : null;
        if (!userId || !csrf || csrf.uid !== userId || csrf.purpose !== "mcp-consent" || csrf.exp < Date.now()) return errorPage(c, "This page expired. Start connecting again from the assistant.");
        const client = f.client_id ? await findClient(c.get("db"), f.client_id) : null;
        if (!client || !f.redirect_uri || !client.redirectUris.includes(f.redirect_uri) || !f.code_challenge) return errorPage(c, "The request wasn't valid. Start again from the assistant.");
        const back = new URL(f.redirect_uri);
        if (f.state) back.searchParams.set("state", f.state);
        if (f.decision !== "allow") {
          back.searchParams.set("error", "access_denied");
          return c.redirect(back.toString());
        }
        const code = `wdk_${randomToken(24)}`;
        await c
          .get("db")
          .insert(mcpCodes)
          .values({ codeHash: await hashToken(code), clientId: client.id, userId, redirectUri: f.redirect_uri, codeChallenge: f.code_challenge, scope: SCOPE, expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) });
        const [u] = await c.get("db").select({ changes: users.assistantChanges }).from(users).where(eq(users.id, userId));
        await c.get("db").insert(events).values({ userId, entityType: "sync", action: "settings.assistant_connected", summary: `Connected the assistant ${client.name}${u?.changes ? " (changes allowed)" : " (read only)"}` });
        back.searchParams.set("code", code);
        back.searchParams.set("iss", publicBase(c));
        return c.redirect(back.toString());
      })

      .post("/token", async (c) => {
        const db = c.get("db");
        const type = c.req.header("content-type") ?? "";
        const f = (type.includes("json") ? await c.req.json().catch(() => ({})) : await c.req.parseBody()) as Record<string, string>;
        const fail = (error: string, description: string) => c.json({ error, error_description: description }, 400);
        c.header("Cache-Control", "no-store");
        if (f.grant_type === "authorization_code") {
          const [row] = await db.select().from(mcpCodes).where(eq(mcpCodes.codeHash, await hashToken(f.code ?? "")));
          if (!row) return fail("invalid_grant", "Unknown or used code");
          await db.delete(mcpCodes).where(eq(mcpCodes.id, row.id)); // one use only
          if (row.expiresAt < new Date()) return fail("invalid_grant", "The code expired");
          if (f.client_id && f.client_id !== row.clientId) return fail("invalid_grant", "The code belongs to another client");
          if (f.redirect_uri && f.redirect_uri !== row.redirectUri) return fail("invalid_grant", "Return address doesn't match");
          if (!f.code_verifier || base64url(await sha256(f.code_verifier)) !== row.codeChallenge) return fail("invalid_grant", "PKCE check failed");
          return c.json(await issueTokens(db, row.userId, row.clientId, row.scope));
        }
        if (f.grant_type === "refresh_token") {
          const [row] = await db
            .select()
            .from(mcpTokens)
            .where(and(eq(mcpTokens.tokenHash, await hashToken(f.refresh_token ?? "")), eq(mcpTokens.kind, "refresh")));
          if (!row || row.expiresAt < new Date()) return fail("invalid_grant", "Unknown or expired refresh token");
          if (f.client_id && f.client_id !== row.clientId) return fail("invalid_grant", "The token belongs to another client");
          await db.delete(mcpTokens).where(eq(mcpTokens.id, row.id)); // replaced on every use
          return c.json(await issueTokens(db, row.userId, row.clientId, row.scope));
        }
        return fail("unsupported_grant_type", "Use authorization_code or refresh_token");
      })

      // RFC 7009: always 200.
      .post("/revoke", async (c) => {
        const type = c.req.header("content-type") ?? "";
        const f = (type.includes("json") ? await c.req.json().catch(() => ({})) : await c.req.parseBody()) as Record<string, string>;
        if (f.token) await c.get("db").delete(mcpTokens).where(eq(mcpTokens.tokenHash, await hashToken(f.token)));
        return c.body(null, 200);
      })
  );
}

