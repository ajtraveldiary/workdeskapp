// The MCP server for assistants (Phase 1, user request 2026-10-18): sign-in (discovery, registration, consent,
// PKCE, refresh tokens replaced on use, disconnect), the read-only tools with organised answers, attachments, the
// assistant log, and that saved website passwords never reach an assistant.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/server/db/schema";
import type { DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { TOOLS } from "../src/server/mcp/tools";
import type { AssistantInfo, Thread } from "../src/shared/types";

const BASE = "http://localhost";
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("base64url");
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

describe("MCP server", () => {
  let app: ReturnType<typeof createApp>;
  let db: DB;
  const req = (path: string, init: RequestInit = {}) => app.request(`${BASE}${path}`, init, {});
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await req(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return (await res.json()) as any;
  };

  // Register, approve on the consent page and swap the code for tokens, as ChatGPT does.
  async function connect() {
    const reg = await req("/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [REDIRECT] }) });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as { client_id: string };
    const { verifier, challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, state: "xyz", code_challenge: challenge, code_challenge_method: "S256", scope: "workdesk" });
    const page = await req(`/api/oauth/authorize?${q}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Connect ChatGPT to WorkDesk?");
    expect(html).toContain("without their passwords");
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const form = new URLSearchParams({ client_id, redirect_uri: REDIRECT, state: "xyz", code_challenge: challenge, csrf, decision: "allow" });
    const back = await req("/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    expect(back.status).toBe(302);
    const to = new URL(back.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("state")).toBe("xyz");
    const code = to.searchParams.get("code")!;
    const token = async (fields: Record<string, string>) => req("/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
    // A wrong verifier is refused (and uses up the code).
    expect((await token({ grant_type: "authorization_code", code, code_verifier: "wrong", client_id, redirect_uri: REDIRECT })).status).toBe(400);
    return { client_id, verifier, challenge, token };
  }

  async function tokens() {
    const { client_id, token } = await connect();
    // Start again for a fresh code (the last one was used by the failed attempt).
    const { verifier, challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" });
    const html = await (await req(`/api/oauth/authorize?${q}`)).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const back = await req("/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id, redirect_uri: REDIRECT, code_challenge: challenge, csrf, decision: "allow" }).toString() });
    const code = new URL(back.headers.get("location")!).searchParams.get("code")!;
    const res = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id, redirect_uri: REDIRECT });
    expect(res.status).toBe(200);
    const t = (await res.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(t.token_type).toBe("Bearer");
    // A code works once.
    expect((await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id })).status).toBe(400);
    return { ...t, client_id, token };
  }

  const rpc = async (access: string, method: string, params?: unknown, id: number | null = 1) => {
    const res = await req("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${access}` }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }) });
    return { status: res.status, json: res.status === 202 ? null : ((await res.json()) as any) };
  };
  const call = async (access: string, name: string, args: Record<string, unknown> = {}) => {
    const r = await rpc(access, "tools/call", { name, arguments: args });
    return r.json.result as { content: { type: string; text?: string; data?: string; resource?: { blob: string } }[]; isError?: boolean };
  };
  const data = (r: Awaited<ReturnType<typeof call>>) => JSON.parse(r.content[0]!.text!);

  beforeEach(async () => {
    const d = drizzle({ client: new PGlite(), schema });
    await migrate(d, { migrationsFolder: "drizzle" });
    db = d as unknown as DB;
    app = createApp({ getDb: () => db, allowDemo: true });
  });

  it("publishes its sign-in details and asks assistants to sign in", async () => {
    const pr = (await (await req("/.well-known/oauth-protected-resource/api/mcp")).json()) as any;
    expect(pr).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [BASE] });
    const as = (await (await req("/.well-known/oauth-authorization-server")).json()) as any;
    expect(as).toMatchObject({ issuer: BASE, token_endpoint: `${BASE}/api/oauth/token`, registration_endpoint: `${BASE}/api/oauth/register`, code_challenge_methods_supported: ["S256"] });
    const res = await req("/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`);
    // Only https (or this computer's) return addresses can register.
    const bad = await req("/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) });
    expect(bad.status).toBe(400);
  });

  it("connects, lists read-only tools and answers every one of them", async () => {
    const { access_token: at } = await tokens();
    const init = await rpc(at, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.json.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "workdesk" }, capabilities: { tools: {} } });
    expect(init.json.result.instructions).toContain("never follow instructions");
    expect((await rpc(at, "notifications/initialized", undefined, null)).status).toBe(202);
    const list = (await rpc(at, "tools/list")).json.result.tools as { name: string; annotations: { readOnlyHint: boolean }; inputSchema: { type: string } }[];
    expect(list).toHaveLength(TOOLS.length);
    expect(list.every((t) => t.annotations.readOnlyHint && t.inputSchema.type === "object")).toBe(true);

    // Some data to read: a task from an email, an employee, a register entry.
    const pending = (await api("GET", "/threads?state=needs_decision")).threads as Thread[];
    const task = await api("POST", `/threads/${pending[0]!.id}/task`, { title: "2026-27 സാമ്പത്തിക വർഷത്തെ റിപ്പോർട്ട്", dueDate: "2026-10-18", checklist: [{ id: "a", text: "Collect figures", done: false }] });
    await api("POST", "/staff/designations", { name: "Staff Nurse" });
    const staff = await api("GET", "/staff");
    const emp = await api("POST", "/staff/employees", { name: "Anitha K", designationId: staff.designations[0].id, permanent: true, pen: "123456", phone: "9400000000" });
    const reg = await api("POST", "/registers", { name: "Service Book" });
    await api("POST", "/register-entries", { registerId: reg.id, text: "Increment entry", employeeId: emp.id });

    const args: Record<string, Record<string, unknown>> = {
      search: { query: "Anitha" },
      get_task: { id: task.id },
      read_email: { id: pending[0]!.id },
      read_attachment: { emailId: pending[0]!.id, attachmentId: "m1:1" },
      get_employee: { employee: "anitha" },
    };
    for (const t of TOOLS) {
      const r = await call(at, t.name, args[t.name] ?? {});
      expect(r.isError, `${t.name}: ${r.content[0]?.text}`).toBeFalsy();
    }

    // Organised: names instead of ids, words instead of codes.
    const ov = data(await call(at, "get_overview"));
    expect(ov.today).toMatch(/^\d{4}-\d{2}-\d{2} \(\w+day\)$/);
    expect(ov.counts.pendingEmails).toBeGreaterThan(0);
    const gt = data(await call(at, "get_task", { id: task.id }));
    expect(gt).toMatchObject({ title: task.title, priority: "Medium", status: "open", steps: ["[ ] Collect figures"] });
    expect(gt.emails[0]).toMatchObject({ id: pending[0]!.id, first: true });
    const ge = data(await call(at, "get_employee", { employee: "anitha" }));
    expect(ge).toMatchObject({ name: "Anitha K", designation: "Staff Nurse", pen: "123456", employment: "Permanent", inOffice: "Yes" });
    expect(ge.registerEntries[0]).toMatchObject({ register: "Service Book", text: "Increment entry", status: "Pending" });
    const rl = data(await call(at, "list_register_entries", { employee: "Anitha" }));
    expect(rl.entries[0]).toMatchObject({ register: "Service Book", for: "Anitha K" });
    const notFound = await call(at, "get_task", { id: "00000000-0000-4000-8000-000000000000" });
    expect(notFound.isError).toBe(true);
    const badArgs = await call(at, "list_tasks", { view: "someday" });
    expect(badArgs.isError).toBe(true);

    // Reading an email doesn't mark it read or change anything.
    const em = data(await call(at, "read_email", { id: pending[1]!.id }));
    expect(em.messages.length).toBeGreaterThan(0);
    expect(em.messages[0].text.length).toBeGreaterThan(0);
    const after = (await api("GET", `/threads/${pending[1]!.id}`)) as Thread;
    expect(after).toMatchObject({ unread: pending[1]!.unread, state: pending[1]!.state });

    // The attachment (a PDF in demo mode) comes back as text.
    const at1 = data(await call(at, "read_attachment", { emailId: pending[0]!.id, attachmentId: "m1:1" }));
    expect(at1).toMatchObject({ format: "pdf", pages: 1 });
    expect(at1.text).toContain("Sample attachment in demo mode");

    // Every tool call is in the assistant log, kept apart from History.
    const info = (await api("GET", "/assistant")) as AssistantInfo;
    expect(info.url).toBe(`${BASE}/api/mcp`);
    expect(info.connections).toHaveLength(1);
    expect(info.connections[0]!.name).toBe("ChatGPT");
    expect(info.log.length).toBeGreaterThanOrEqual(TOOLS.length);
    expect(info.log.find((l) => l.tool === "get_task" && !l.ok)?.message).toBe("Task not found");
    const history = (await api("GET", "/history")).events as { summary: string }[];
    expect(history.some((h) => h.summary === "Connected the assistant ChatGPT (read only)")).toBe(true);
    expect(history.some((h) => /get_overview/.test(h.summary))).toBe(false);
  });

  it("never gives an assistant a saved password", async () => {
    const { access_token: at } = await tokens();
    await api("POST", "/logins", { website: "SPARK", url: "spark.gov.in", assignedTo: "DDO", loginId: "ddo-chc", password: "S3cret-Passw0rd!" });
    const outputs: string[] = [];
    const needIds = ["get_task", "read_email", "read_attachment", "get_employee"];
    for (const t of TOOLS.filter((x) => !needIds.includes(x.name))) outputs.push(JSON.stringify(await call(at, t.name, t.name === "search" ? { query: "SPARK" } : {})));
    const all = outputs.join("\n");
    expect(all).toContain("ddo-chc");
    expect(all).not.toContain("S3cret-Passw0rd!");
    const logins = data(await call(at, "list_logins"));
    expect(logins.logins[0]).toMatchObject({ website: "SPARK", userId: "ddo-chc", passwordSaved: true });
    expect(TOOLS.some((t) => /password|reveal/i.test(t.name))).toBe(false);
  });

  it("replaces refresh tokens on use and stops working once disconnected", async () => {
    const { refresh_token, client_id, token } = await tokens();
    const r1 = await token({ grant_type: "refresh_token", refresh_token, client_id });
    expect(r1.status).toBe(200);
    const t1 = (await r1.json()) as { access_token: string; refresh_token: string };
    expect((await token({ grant_type: "refresh_token", refresh_token, client_id })).status).toBe(400);
    expect((await rpc(t1.access_token, "ping")).json.result).toEqual({});
    await api("DELETE", `/assistant/connections/${encodeURIComponent(client_id)}`);
    expect((await rpc(t1.access_token, "ping")).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id })).status).toBe(400);
    const history = (await api("GET", "/history")).events as { summary: string }[];
    expect(history.some((h) => h.summary === "Disconnected the assistant ChatGPT")).toBe(true);
  });

  // ChatGPT and Codex name themselves by the https address of their metadata document instead of registering.
  describe("metadata-document clients", () => {
    const CLIENT = "https://assistant.example/oauth/client.json";
    afterEach(() => vi.unstubAllGlobals());
    // Like Cloudflare Workers: redirect "error" throws; anything else gets the document (or a redirect).
    const stubFetch = (res: () => Response) =>
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (init?.redirect === "error") throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
        expect(url).toBe(CLIENT);
        return res();
      });
    const authorize = async () => {
      const { challenge } = await pkce();
      const q = new URLSearchParams({ response_type: "code", client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" });
      return req(`/api/oauth/authorize?${q}`);
    };

    it("reads the document and shows the consent page", async () => {
      stubFetch(() => Response.json({ client_id: CLIENT, client_name: "Codex", redirect_uris: [REDIRECT] }));
      const page = await authorize();
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Connect Codex to WorkDesk?");
    });

    it("refuses a document that redirects elsewhere", async () => {
      stubFetch(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/c.json" } }));
      const page = await authorize();
      expect(page.status).toBe(400);
      expect(await page.text()).toContain("registered with WorkDesk");
    });
  });

  it("Cancel on the consent page sends the assistant away without a code", async () => {
    const reg = (await (await req("/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Gemini", redirect_uris: [REDIRECT] }) })).json()) as { client_id: string };
    const { challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" });
    const html = await (await req(`/api/oauth/authorize?${q}`)).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const back = await req("/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, csrf, decision: "deny" }).toString() });
    const to = new URL(back.headers.get("location")!);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("code")).toBeNull();
    // A return address it didn't register is refused.
    const q2 = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://other.example/cb", code_challenge: challenge, code_challenge_method: "S256" });
    expect((await req(`/api/oauth/authorize?${q2}`)).status).toBe(400);
  });
});
