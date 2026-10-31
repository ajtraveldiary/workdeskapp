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
import { CHANGE_TOOLS } from "../src/server/mcp/changes";
import { STAFF_TOOLS } from "../src/server/mcp/staff";
import { LEAVE_READ_TOOLS, LEAVE_STAFF_TOOLS } from "../src/server/mcp/leave";
import { ATTENDANCE_READ_TOOLS, ATTENDANCE_STAFF_TOOLS } from "../src/server/mcp/attendance";
import { PROMPT_TOOL } from "../src/server/mcp/prompts";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
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

  afterEach(() => vi.unstubAllGlobals());

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
    expect(list).toHaveLength(TOOLS.length + LEAVE_READ_TOOLS.length + ATTENDANCE_READ_TOOLS.length + 1 + CHANGE_TOOLS.length + STAFF_TOOLS.length + LEAVE_STAFF_TOOLS.length + ATTENDANCE_STAFF_TOOLS.length);
    expect(list.filter((t) => t.annotations.readOnlyHint).map((t) => t.name)).toEqual([...TOOLS.map((t) => t.name), ...LEAVE_READ_TOOLS.map((t) => t.name), ...ATTENDANCE_READ_TOOLS.map((t) => t.name), PROMPT_TOOL.name]);
    expect(list.every((t) => t.inputSchema.type === "object")).toBe(true);
    // No tool deletes anything.
    expect(list.some((t) => /delete/i.test(t.name))).toBe(false);

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
    expect(gt).toMatchObject({ title: task.title, priority: "Medium", status: "open", steps: ["1. [ ] Collect figures"] });
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

  // --- Phase 3: changes (user request 2026-10-18) ---

  it("makes no change until Allow changes is on, then changes tasks the way the app does, marked in History and the log", async () => {
    const { access_token: at } = await tokens();
    const title = "2026-27 സാമ്പത്തിക വർഷത്തെ 2210-ഓൺലൈൻ റീകൺസിലിയേഷൻ പൂർത്തിയാക്കി ജില്ലാ മെഡിക്കൽ ഓഫീസർക്ക് റിപ്പോർട്ട് സമർപ്പിക്കുന്നത് സംബന്ധിച്ച്";
    const off = await call(at, "create_task", { title });
    expect(off.isError).toBe(true);
    expect(off.content[0]!.text).toContain("switched off");

    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 30 });
    expect(((await api("GET", "/history")).events as { summary: string }[])[0]!.summary).toBe("Assistants may now make changes");
    await api("POST", "/staff/designations", { name: "Staff Nurse" });
    const staff = await api("GET", "/staff");
    const emp = await api("POST", "/staff/employees", { name: "Anitha K", designationId: staff.designations[0].id });

    const made = data(await call(at, "create_task", { title, dueDate: "2026-10-30", dueTime: "10:30", priority: "high", notes: "From the DMO", steps: ["Collect figures", "Send to DMO"], tags: ["Audit"], for: "anitha", links: [{ url: "docs.google.com/spreadsheets/d/abc", name: "HMIS sheet" }] }));
    expect(made.task.links).toEqual([{ url: "https://docs.google.com/spreadsheets/d/abc", name: "HMIS sheet" }]);
    expect(made.task).toMatchObject({ title, priority: "High", due: "2026-10-30 10:30", for: "Anitha K (Staff Nurse)", tags: ["Audit"], steps: ["1. [ ] Collect figures", "2. [ ] Send to DMO"] });
    const id = made.task.id as string;
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    expect(row).toMatchObject({ title, relatedKind: "employee", relatedId: emp.id, priority: "high" });

    const changed = data(await call(at, "update_task", { id, tickSteps: [1], addSteps: ["File the copy"], addToNotes: "Reply by Friday", waitingForReply: true, replyBy: "2026-11-02" }));
    expect(changed.task).toMatchObject({ status: "waiting for a reply", steps: ["1. [x] Collect figures", "2. [ ] Send to DMO", "3. [ ] File the copy"], notes: "From the DMO\nReply by Friday" });
    expect((await call(at, "update_task", { id, tickSteps: [9] })).isError).toBe(true);
    expect(data(await call(at, "complete_tasks", { ids: [id] })).tasks[0].result).toBe("completed");
    expect(data(await call(at, "reopen_tasks", { ids: [id] })).tasks[0].result).toBe("reopened");
    expect((await call(at, "complete_tasks", { ids: Array.from({ length: 11 }, () => id) })).isError).toBe(true);

    // A name that fits more than one: the assistant is told the choices, nothing changes.
    await api("POST", "/staff/employees", { name: "Anitha M", designationId: staff.designations[0].id });
    const unclear = await call(at, "update_task", { id, for: "anitha" });
    expect(unclear.isError).toBe(true);
    expect(unclear.content[0]!.text).toContain("Anitha K, Anitha M");

    // History entries say which assistant made them; the log has what changed.
    const history = ((await api("GET", "/history")).events as { summary: string }[]).map((h) => h.summary);
    expect(history).toContain("Created manually (via ChatGPT)");
    expect(history).toContain("Completed (via ChatGPT)");
    expect(history.some((h) => h.startsWith("Assistants may now make changes ("))).toBe(false);
    const changes = ((await api("GET", "/assistant?changes=1")) as AssistantInfo).log;
    expect(changes.every((l) => l.change)).toBe(true);
    expect(changes.find((l) => l.tool === "create_task" && l.ok)!.touched).toEqual([{ kind: "task", id, title }]);
    expect(changes.find((l) => l.tool === "create_task" && !l.ok)!.message).toContain("switched off");
  });

  it("emails, register entries and events change as in the app; the hourly limit holds", async () => {
    const { access_token: at } = await tokens();
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 100 });
    const pending = (await api("GET", "/threads?state=needs_decision")).threads as Thread[];
    const [a, b, c, d, e] = pending as [Thread, Thread, Thread, Thread, Thread];
    const state = async (id: string) => ((await api("GET", `/threads/${id}`)) as Thread).state;

    const t = data(await call(at, "make_task_from_email", { emailId: a.id, title: "Reply to the circular" }));
    expect(await state(a.id)).toBe("task");
    expect(t.task.email.id).toBe(a.id);
    expect((await call(at, "make_task_from_email", { emailId: a.id, title: "Again" })).isError).toBe(true);
    expect(data(await call(at, "add_emails_to", { emailIds: [b.id], taskId: t.task.id })).added).toBe(1);
    expect(await state(b.id)).toBe("task");
    await call(at, "take_email_off", { emailId: b.id, taskId: t.task.id });
    expect(await state(b.id)).toBe("needs_decision");

    expect(data(await call(at, "remove_emails", { emailIds: [b.id] })).removed).toBe(1);
    expect(await state(b.id)).toBe("dismissed");
    expect(data(await call(at, "remove_emails", { emailIds: [c.id], section: "accounts" })).moved).toBe(1);
    expect(await state(c.id)).toBe("elsewhere");
    expect((await call(at, "remove_emails", { emailIds: [d.id], section: "Nowhere" })).isError).toBe(true);

    await api("POST", "/registers", { name: "Service Book" });
    const entry = data(await call(at, "add_register_entry", { register: "service book", text: "Increment entry", dueDate: "2026-10-25" }));
    expect(entry.taskId).toBeTruthy();
    await call(at, "update_register_entry", { id: entry.entryId, text: "Increment entry 2026" });
    await call(at, "set_register_entry_done", { id: entry.entryId, done: true });
    const entries = (await api("GET", "/register-entries")).entries as { id: string; text: string; status: string; task: { status: string } }[];
    expect(entries.find((x) => x.id === entry.entryId)).toMatchObject({ text: "Increment entry 2026", status: "done", task: { status: "done" } });

    const ev = data(await call(at, "create_event", { title: "District review meeting", date: "2026-11-05", type: "meeting", startTime: "10:00", endTime: "11:00", venue: "DMO office", emailId: d.id }));
    expect(ev).toMatchObject({ type: "Meeting", date: "2026-11-05" });
    expect(await state(d.id)).toBe("event");
    await call(at, "set_event_date", { eventId: ev.eventId, date: "2026-11-05", status: "moved", newDate: "2026-11-06" });
    const listed = data(await call(at, "list_events", { from: "2026-11-01", to: "2026-11-30" }));
    expect(listed.events[0]).toMatchObject({ title: "District review meeting", movedFrom: "2026-11-05" });
    expect(listed.events[0].date).toMatch(/^2026-11-06/);

    // The hourly limit: changes stop once it is reached, and the refusal is logged.
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 1 });
    const limited = await call(at, "remove_emails", { emailIds: [e.id] });
    expect(limited.isError).toBe(true);
    expect(limited.content[0]!.text).toContain("1 changes an hour");
    expect(await state(e.id)).toBe("needs_decision");
  });

  it("won't tick a Contract ends or Probation task (they ask a question in WorkDesk)", async () => {
    const { access_token: at } = await tokens();
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 30 });
    const t = await api("POST", "/tasks", { title: "Contract ends: Rajan" });
    await db.update(schema.tasks).set({ systemKind: "contract", madeBySystem: true }).where(eq(schema.tasks.id, t.id));
    const r = data(await call(at, "complete_tasks", { ids: [t.id] }));
    expect(r.tasks[0].result).toContain("Not ticked");
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
    expect(row!.status).toBe("open");
  });

  it("never reaches Gmail itself: changes go through the app's routes and their Gmail rules", () => {
    for (const f of readdirSync("src/server/mcp")) {
      const text = readFileSync(`src/server/mcp/${f}`, "utf8");
      expect(text, f).not.toMatch(/lib\/gmail|gmailAuth|setThreadLabels|markThreadRead|googleapis/);
    }
  });

  // --- Phase 4: staff actions (user request 2026-10-18) ---

  // Leave (user request 2026-10-30): read the leave account; mark leave is a staff action.
  it("reads a leave account and marks leave as the app does", async () => {
    const { access_token: at } = await tokens();
    await api("POST", "/leave/types/usual");
    const types = (await api("GET", "/leave/types")).types as { id: string; short: string }[];
    const hpl = types.find((t) => t.short === "HPL")!;
    const id = (await api("POST", "/staff/employees", { name: "Anitha K", gazetted: true })).id as string;
    await api("POST", `/leave/accounts/${id}/lines`, { typeId: hpl.id, kind: "opening", onDate: "2026-01-01", days: 40 });
    expect(data(await call(at, "get_leave_account", { employee: "anitha" })).balances).toEqual(expect.arrayContaining([{ leave: "HPL", days: 40 }]));
    const off = await call(at, "mark_leave", { employee: "Anitha K", leave: "HPL", from: "2026-11-02", to: "2026-11-11" });
    expect(off.isError).toBe(true);
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 100, allowStaff: true });
    expect(data(await call(at, "mark_leave", { employee: "Anitha K", leave: "xyz", from: "2026-11-02", to: "2026-11-11" })).error).toContain("Leave types are");
    const marked = data(await call(at, "mark_leave", { employee: "Anitha K", leave: "half pay", from: "2026-11-02", to: "2026-11-11", stepsDone: ["leave application"] }));
    expect(marked.done).toBe("Half pay leave marked for Anitha K: 10 days, 2026-11-02 to 2026-11-11");
    const acc = data(await call(at, "get_leave_account", { employee: "Anitha K" }));
    expect(acc.balances).toEqual(expect.arrayContaining([{ leave: "HPL", days: 30 }]));
    expect(acc.leaves[0]).toMatchObject({ leave: "HPL", from: "2026-11-02", to: "2026-11-11", days: 10, dueBack: "2026-11-12", steps: "1 of 7 done" });
  });

  it("reads the attendance register and marks it as the app does", async () => {
    const { access_token: at } = await tokens();
    const a = (await api("POST", "/staff/employees", { name: "Anitha K" })).id as string;
    await api("POST", "/staff/employees", { name: "Biju" });
    await api("POST", "/attendance/holidays", { date: "2026-10-02", name: "Gandhi Jayanthi" });
    const off = await call(at, "mark_attendance", { date: "2026-10-05", mark: "present" });
    expect(off.isError).toBe(true);
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 100, allowStaff: true });
    // Everyone on 2 Oct (holiday duty) and 5 Oct; Anitha on CL 6–7 Oct; a CH for the holiday on 8 Oct.
    expect(data(await call(at, "mark_attendance", { date: "2026-10-05", mark: "present" })).done).toBe("Present: 2 marked");
    await call(at, "mark_attendance", { date: "2026-10-02", mark: "present" });
    const cl = data(await call(at, "mark_attendance", { date: "2026-10-06", to: "2026-10-07", employees: ["anitha"], mark: "cl" }));
    expect(cl.done).toBe("Casual leave: 2 marked");
    expect(data(await call(at, "mark_attendance", { date: "2026-10-08", employees: ["Anitha K"], mark: "ch" })).error).toContain("which holiday");
    expect(data(await call(at, "mark_attendance", { date: "2026-10-08", employees: ["Anitha K"], mark: "ch", holidayWorked: "2026-10-02" })).done).toBe("Compensation leave: 1 marked");
    // A holiday takes only present: CL there is left out, and said so.
    expect(data(await call(at, "mark_attendance", { date: "2026-10-04", employees: ["Biju"], mark: "cl" })).leftOut).toEqual({ holiday: 1 });
    const month = data(await call(at, "get_attendance", { month: "2026-10", employee: "Anitha" }));
    expect(month.holidays).toEqual([{ date: "2026-10-02", name: "Gandhi Jayanthi" }, { date: "2026-10-10", name: "Second Saturday" }]);
    expect(month.people[0]).toMatchObject({ name: "Anitha K", thisMonth: { present: 1, holidayDuty: 1, cl: 2, ch: 1 }, thisYear: { cl: 2, ch: 1 } });
    expect(month.people[0].days).toContain("2026-10-08: CH (Compensation leave)");
    expect(month.people[0].chToTake ?? []).toEqual([]);
    expect(a).toBeTruthy();
  });

  it("staff actions need their own switch, then join, increment, relieve and edit employees as the app does", async () => {
    const { access_token: at } = await tokens();
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 100 });
    await api("POST", "/staff/designations", { name: "Staff Nurse" });
    const off = await call(at, "add_employee", { name: "Anitha K", employment: "permanent" });
    expect(off.isError).toBe(true);
    expect(off.content[0]!.text).toContain("Staff actions are switched off");

    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 100, allowStaff: true });
    const today = (await api("GET", "/me")).today as string;
    const added = data(await call(at, "add_employee", { name: "Anitha K", employment: "permanent", designation: "staff nurse", pen: "123456", nextIncrement: `${today.slice(0, 7)}-01`, basicPay: 35600 }));
    expect(added.employee).toMatchObject({ name: "Anitha K", designation: "Staff Nurse", employment: "Permanent" });
    const id = added.employee.id as string;
    expect((await call(at, "add_employee", { name: "anitha k", employment: "permanent" })).isError).toBe(true);

    const joined = data(await call(at, "join_employee", { employee: "anitha", date: "2026-10-01", stepsDone: ["joining report", "SPARK"] }));
    const steps = (await api("GET", "/moves")).moves[0].steps as { id: string; state: string }[];
    expect(steps.map((x) => x.state)).toEqual(["done", "done", "pending", "pending"]);
    await call(at, "set_joining_step", { employee: "Anitha K", step: "letter", state: "done" });
    await call(at, "set_joining_step", { employee: "Anitha K", step: "service book", state: "waiting" });
    expect(((await api("GET", "/moves")).moves[0].steps as { state: string }[]).map((x) => x.state)).toEqual(["done", "done", "done", "waiting"]);
    expect((await call(at, "set_joining_step", { employee: "Anitha K", step: "s", state: "done" })).isError).toBe(true);
    expect(joined.joiningTaskId).toBeTruthy();

    const inc = data(await call(at, "mark_increment_done", { employee: "123456", newBasicPay: 36500 }));
    expect(inc.basicPay).toBe("₹35600 → ₹36500");
    const emp = () => api("GET", "/staff").then((r) => (r.employees as { id: string }[]).find((x) => x.id === id) as any);
    expect(await emp()).toMatchObject({ basicPay: 36500, joinedOfficeOn: "2026-10-01" });
    expect((await call(at, "mark_increment_done", { employee: "Anitha K" })).isError).toBe(true); // not due again until next year

    await call(at, "update_employee", { employee: "Anitha K", phone: "9400000000", address: "2026-27 സാമ്പത്തിക വർഷത്തെ വിലാസം" });
    expect(await emp()).toMatchObject({ phone: "9400000000", address: "2026-27 സാമ്പത്തിക വർഷത്തെ വിലാസം", pen: "123456", basicPay: 36500, designationId: expect.any(String) });
    await call(at, "declare_probation", { employee: "Anitha K" });
    expect((await emp()).probationDeclaredOn).toBe(today);

    await call(at, "relieve_employee", { employee: "Anitha K", date: today, stepsDone: ["relieving order"] });
    expect((await emp()).leftOn).toBe(today);

    const history = ((await api("GET", "/history")).events as { summary: string }[]).map((h) => h.summary);
    expect(history.some((h) => h.startsWith("Employee added: Anitha K (via ChatGPT)"))).toBe(true);
    expect(history.some((h) => h.startsWith("Increment for Anitha K") && h.endsWith("(via ChatGPT)"))).toBe(true);
    const log = ((await api("GET", "/assistant?changes=1")) as AssistantInfo).log;
    expect(log.find((l) => l.tool === "mark_increment_done" && l.ok)!.touched).toEqual([{ kind: "employee", id, title: "Anitha K" }]);
  });

  it("temporary contracts are renewed or ended, and registers marked updated", async () => {
    const { access_token: at } = await tokens();
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 100, allowStaff: true });
    await api("POST", "/staff/types", { name: "HMC" });
    const t = data(await call(at, "add_employee", { name: "Rajan P", employment: "temporary", type: "hmc", engagedAs: "Daily wage", joinedService: "2026-05-01", contractDays: 180, payPerDay: 675 }));
    const emp = () => api("GET", "/staff").then((r) => (r.employees as { id: string }[]).find((x) => x.id === t.employee.id) as any);
    expect(await emp()).toMatchObject({ permanent: false, engagement: "daily_wage", engagedTill: "2026-10-27", payPerDay: 675 });
    const renewed = data(await call(at, "renew_or_end_contract", { employee: "rajan", choice: "renew" }));
    expect(renewed).toMatchObject({ ended: "2026-10-27", nowEnds: "2027-04-25" });
    await call(at, "renew_or_end_contract", { employee: "rajan", choice: "end" });
    expect((await emp()).leftOn).toBe("2027-04-25");
    // A permanent-only step on someone temporary is refused by the app's own rules.
    expect((await call(at, "declare_probation", { employee: "Rajan P" })).isError).toBe(true);

    const reg = await api("POST", "/registers", { name: "Service Book" });
    const e1 = await api("POST", "/register-entries", { registerId: reg.id, text: "Increment entry" });
    await api("POST", `/register-entries/${e1.id}/done`, { done: true });
    const up = data(await call(at, "mark_register_updated", { register: "service book" }));
    expect(up.doneEntriesCleared).toBe(1);
    expect((await call(at, "mark_register_updated", { register: "Service Book", date: "2999-01-01" })).isError).toBe(true);
  });

  // --- Phase 5: prompts, the bell, CSV export (user request 2026-10-19) ---

  it("offers ready-made prompts", async () => {
    const { access_token: at } = await tokens();
    const init = await rpc(at, "initialize", { protocolVersion: "2025-06-18" });
    expect(init.json.result.capabilities.prompts).toBeDefined();
    const prompts = (await rpc(at, "prompts/list")).json.result.prompts as { name: string; arguments: { name: string; required?: boolean }[] }[];
    expect(prompts.map((x) => x.name)).toEqual(["morning_briefing", "reply_to_email", "employee_status", "monthly_work_diary", "pending_email_triage", "month_end_returns", "weekly_review", "staff_matters"]);
    const brief = (await rpc(at, "prompts/get", { name: "morning_briefing" })).json.result;
    expect(brief.messages[0]).toMatchObject({ role: "user", content: { type: "text" } });
    expect(brief.messages[0].content.text).toContain("get_overview");
    const reply = (await rpc(at, "prompts/get", { name: "reply_to_email", arguments: { email: "HMIS circular", language: "Malayalam" } })).json.result;
    expect(reply.messages[0].content.text).toContain("HMIS circular");
    expect(reply.messages[0].content.text).toContain("Malayalam");
    expect(reply.messages[0].content.text).toContain("can't send email");
    const diary = (await rpc(at, "prompts/get", { name: "monthly_work_diary", arguments: { month: "2026-02" } })).json.result;
    expect(diary.messages[0].content.text).toContain("2026-02-01 to 2026-02-28");
    expect((await rpc(at, "prompts/get", { name: "employee_status", arguments: {} })).json.error.message).toContain("employee");
    expect((await rpc(at, "prompts/get", { name: "nothing" })).json.error).toBeDefined();

    // The same instructions as a tool, for ChatGPT and the Gemini app, which only use tools.
    const viaTool = data(await call(at, "use_prompt", { name: "reply_to_email", email: "HMIS circular", language: "Malayalam" }));
    expect(viaTool).toMatchObject({ prompt: "Reply to this email" });
    expect(viaTool.instructions).toBe(reply.messages[0].content.text);
    const missing = await call(at, "use_prompt", { name: "employee_status" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toContain("employee");
    expect(init.json.result.instructions).toContain("use_prompt");
  });

  it("rings the bell for assistant changes until they are looked at, and exports the log", async () => {
    const { access_token: at } = await tokens();
    expect(await api("GET", "/assistant/unseen")).toEqual({ count: 0, latest: [] });
    await call(at, "get_overview");
    expect((await api("GET", "/assistant/unseen")).count).toBe(0); // reads don't ring
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 30 });
    const title = "2026-27 സാമ്പത്തിക വർഷത്തെ 2210-ഓൺലൈൻ റീകൺസിലിയേഷൻ പൂർത്തിയാക്കി ജില്ലാ മെഡിക്കൽ ഓഫീസർക്ക് റിപ്പോർട്ട് സമർപ്പിക്കുന്നത് സംബന്ധിച്ച്";
    await call(at, "create_task", { title });
    const unseen = await api("GET", "/assistant/unseen");
    expect(unseen.count).toBe(1);
    expect(unseen.latest[0]).toMatchObject({ clientName: "ChatGPT", title: "Create a task", touched: [{ kind: "task", title }] });
    await api("POST", "/assistant/seen");
    expect((await api("GET", "/assistant/unseen")).count).toBe(0);

    const csv = await (await req("/api/assistant/log.csv")).text();
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Time,Assistant,What,Tool,Change,Result,Message,What changed,Request");
    expect(lines.length).toBe(3);
    expect(lines[1]).toContain("Create a task,create_task,Yes,OK");
    expect(lines[1]).toContain(`task: ${title}`);
    const changes = await (await req("/api/assistant/log.csv?changes=1")).text();
    expect(changes.trim().split("\r\n")).toHaveLength(2);
  });

  // ChatGPT names itself by the https address of a metadata document (2026-10-19: reading it with redirect "error"
  // failed on Cloudflare, so every ChatGPT sign-in said "isn't registered").
  it("connects an assistant known by its metadata document address, as ChatGPT does", async () => {
    const id = "https://chatgpt.example/oauth/workdesk/client.json";
    const seen: RequestInit[] = [];
    let answer: () => Response = () => Response.json({ client_id: id, client_name: "ChatGPT", redirect_uris: [REDIRECT] });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe(id);
      seen.push(init);
      return answer();
    });
    const { verifier, challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" });
    const html = await (await req(`/api/oauth/authorize?${q}`)).text();
    expect(html).toContain("Connect ChatGPT to WorkDesk?");
    expect(seen[0]!.redirect).toBe("manual"); // the only values Workers accept are "manual" and "follow"
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const back = await req("/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, redirect_uri: REDIRECT, code_challenge: challenge, csrf, decision: "allow" }).toString() });
    expect(seen).toHaveLength(1); // Allow uses the copy kept a moment ago
    const code = new URL(back.headers.get("location")!).searchParams.get("code")!;
    const tok = await req("/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: id, redirect_uri: REDIRECT }).toString() });
    expect(tok.status).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    expect((await rpc(access_token, "ping")).json.result).toEqual({});

    // When the document can't be read, the page says why.
    answer = () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
    expect(await (await req(`/api/oauth/authorize?${q}`)).text()).toContain("it redirects to https://elsewhere.example/");
    answer = () => new Response("blocked", { status: 403 });
    expect(await (await req(`/api/oauth/authorize?${q}`)).text()).toContain("the address answered 403");
  });

  // --- Office details, reminders and the file register, more prompts (user request 2026-10-19) ---

  it("keeps office details for letters, shows them to assistants and puts them in the backup", async () => {
    const { access_token: at } = await tokens();
    expect((await api("GET", "/office-profile")).profile).toMatchObject({ officeName: "", recipients: [], letterLanguage: "English" });
    const profile = {
      officeName: "Community Health Centre, Vellanad",
      address: "Vellanad P.O., Thiruvananthapuram",
      seat: "B1",
      signature: "Medical Officer in charge",
      fileNumberPattern: "B1-{no}/{year}/CHCV",
      recipients: [{ who: "District Medical Officer (Health), Thiruvananthapuram", address: "DMO Office, Thycaud" }],
      codes: [{ label: "DDO code", value: "1234567890" }],
      letterLanguage: "Malayalam",
    };
    await api("PUT", "/office-profile", profile);
    expect((await api("GET", "/office-profile")).profile).toMatchObject(profile);
    expect(((await api("GET", "/history")).events as { summary: string }[])[0]!.summary).toBe("Office details saved: Community Health Centre, Vellanad");
    const settings = data(await call(at, "get_settings"));
    expect(settings.officeDetails).toMatchObject({ officeName: profile.officeName, seat: "B1", signatureBlock: profile.signature, officeCodes: ["DDO code: 1234567890"], lettersIn: "Malayalam" });
    expect(settings.officeDetails.fileNumberPattern).toContain("B1-{no}/{year}/CHCV");
    expect(settings.officeDetails.usualRecipients[0]).toEqual({ who: profile.recipients[0]!.who, address: "DMO Office, Thycaud" });
    const reply = (await rpc(at, "prompts/get", { name: "reply_to_email", arguments: { email: "HMIS circular" } })).json.result.messages[0].content.text as string;
    expect(reply).toContain("office details");
    expect(reply).toContain("lettersIn");
    const backup = await api("GET", "/transfer/backup");
    expect(backup.tables.officeProfiles[0].data.officeName).toBe(profile.officeName);
    expect((await req("/api/office-profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "not an email" }) })).status).toBe(400);
  });

  it("creates, changes, pauses reminders and marks their dates; adds and changes file register entries", async () => {
    const { access_token: at } = await tokens();
    await api("PUT", "/assistant/settings", { allowChanges: true, perHour: 100 });
    const today = (await api("GET", "/me")).today as string;
    // Reminder names stop at 120 characters, as in the app's form; a longer one is refused.
    const long = "2026-27 സാമ്പത്തിക വർഷത്തെ 2210-ഓൺലൈൻ റീകൺസിലിയേഷൻ പൂർത്തിയാക്കി ജില്ലാ മെഡിക്കൽ ഓഫീസർക്ക് റിപ്പോർട്ട് സമർപ്പിക്കുന്നത് സംബന്ധിച്ച്";
    expect((await call(at, "create_reminder", { name: long, date: today })).isError).toBe(true);
    const name = "2026-27 സാമ്പത്തിക വർഷത്തെ 2210-ഓൺലൈൻ റീകൺസിലിയേഷൻ റിപ്പോർട്ട്";
    const made = data(await call(at, "create_reminder", { name, date: today, repeat: "monthly", remindDaysBefore: 7, priority: "high", links: [{ url: "docs.google.com/spreadsheets/d/abc", name: "HMIS sheet" }], tags: ["Returns"] }));
    expect(made).toMatchObject({ done: "Reminder created", name });
    const rem = () => api("GET", "/reports").then((r) => (r.reports as { id: string; name: string; active: boolean; priority: string; links: { url: string }[]; periods: { dueDate: string; status: string }[] }[]).find((x) => x.id === made.reminderId)!);
    expect(await rem()).toMatchObject({ priority: "high", active: true, links: [{ url: "https://docs.google.com/spreadsheets/d/abc", name: "HMIS sheet" }] });
    expect((await rem()).periods.some((p) => p.dueDate === today)).toBe(true);

    await call(at, "set_reminder_date", { reminder: "2210", date: today, done: true });
    expect((await rem()).periods.find((p) => p.dueDate === today)!.status).toBe("submitted");
    await call(at, "set_reminder_date", { reminder: "2210", date: today, done: false });
    expect((await rem()).periods.find((p) => p.dueDate === today)!.status).toBe("pending");
    expect((await call(at, "set_reminder_date", { reminder: "2210", date: "2099-01-01", done: true })).isError).toBe(true);

    expect(data(await call(at, "update_reminder", { reminder: "2210", paused: true })).done).toBe("Reminder paused");
    expect((await rem()).active).toBe(false);
    await call(at, "update_reminder", { reminder: made.reminderId, paused: false, priority: "low" });
    expect(await rem()).toMatchObject({ active: true, priority: "low" });
    expect((await call(at, "update_reminder", { reminder: "nothing like this" })).isError).toBe(true);

    const f = data(await call(at, "add_file", { subject: "Stock verification 2026-27", tags: ["Audit"] }));
    expect(f).toMatchObject({ subject: "Stock verification 2026-27", eFileNumber: "not created yet" });
    await call(at, "add_file", { subject: "Purchase file", kind: "e-file", eFileNumber: "999/2026" });
    expect(data(await call(at, "update_file", { file: "stock verification", eFileNumber: "12345/2026" })).eFileNumber).toBe("12345/2026");
    const files = (await api("GET", "/files")).files as { subject: string; efileNumber: string; tagIds: string[] }[];
    expect(files.find((x) => x.subject === "Stock verification 2026-27")).toMatchObject({ efileNumber: "12345/2026" });
    expect(files.find((x) => x.subject === "Stock verification 2026-27")!.tagIds).toHaveLength(1); // tags kept
    const clash = await call(at, "update_file", { file: "12345/2026", eFileNumber: "999/2026" });
    expect(clash.isError).toBe(true);
    expect(clash.content[0]!.text).toContain("Purchase file");

    const history = ((await api("GET", "/history")).events as { summary: string }[]).map((h) => h.summary);
    expect(history).toContain("Reminder created (via ChatGPT)");
    expect(history).toContain("Paused (via ChatGPT)");
    expect(history.some((h) => h.startsWith("E-file 12345/2026 noted") && h.endsWith("(via ChatGPT)"))).toBe(true);
  });

  it("offers the new prompts, also through use_prompt", async () => {
    const { access_token: at } = await tokens();
    const get = async (name: string, args: Record<string, unknown> = {}) => data(await call(at, "use_prompt", { name, ...args })).instructions as string;
    const triage = await get("pending_email_triage", { count: 15 });
    expect(triage).toContain("the newest 15");
    expect(triage).toContain("no second confirmation");
    expect(triage).toContain("at most 10 emails per call");
    expect(await get("month_end_returns", { month: "2026-02" })).toContain("2026-02-01 to 2026-02-28");
    expect(await get("weekly_review")).toContain("the week ahead");
    expect(await get("staff_matters")).toContain("Increments due");
  });
});
