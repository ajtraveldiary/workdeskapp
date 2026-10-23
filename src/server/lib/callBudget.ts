// Calls budget (user request 2026-10-23, "Too many subrequests"): a Cloudflare Worker run may make only so many
// outgoing calls (50 on the free plan), and every Neon query and Gmail request is one. Inside a budget the counter
// refuses the next call with OutOfCalls once only the reserve is left, so the queue (lib/queue.ts) can still write
// down where it stopped and carry on in the next run, instead of Cloudflare failing every call that follows.
// Every call is also recorded in the budget's log (user request 2026-10-23, "every subrequest must be logged in this
// queue"), written once per request by lib/callLog.ts and shown in Settings › Queue.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Env } from "../env";
import type { CallEntry } from "../../shared/types";
import { gmailPathOf } from "./gmail";

export type CallBudget = {
  limit: number;
  used: number;
  // Kept back for the queue's own bookkeeping; only `spare` may use it.
  reserve: number;
  spare: boolean;
  // Set once a call was refused, so work that swallowed the error is still known to be unfinished.
  ranOut: boolean;
  // When the run started, every call it made, the queue job running now and the request made inside this one
  // (an assistant's tool reading through the app's routes, a saved change being done again).
  startedAt: number;
  log: CallEntry[];
  job?: string;
  inner?: string;
};

export class OutOfCalls extends Error {
  constructor() {
    super("This run's calls to the database and Gmail are used up");
  }
}

const store = new AsyncLocalStorage<CallBudget>();

// SUBREQUEST_LIMIT in wrangler.jsonc (50 on the free plan); unset (local Node) means no limit.
export function callLimit(env: Env) {
  const n = Number(env.SUBREQUEST_LIMIT);
  return n > 0 ? n : Infinity;
}

export const newBudget = (limit: number, reserve = 3): CallBudget => ({ limit, used: 0, reserve, spare: false, ranOut: false, startedAt: Date.now(), log: [] });

export const withCalls = <T>(budget: CallBudget, fn: () => Promise<T>) => store.run(budget, fn);

export const currentBudget = () => store.getStore();

// Calls still allowed for ordinary work (Infinity outside a budget).
export function callsLeft() {
  const b = store.getStore();
  return b ? Math.max(0, b.limit - b.reserve - b.used) : Infinity;
}

// Refuses up front when n calls won't fit, before anything is half done.
export function needCalls(n: number) {
  const b = store.getStore();
  if (b && callsLeft() < n) {
    b.ranOut = true;
    throw new OutOfCalls();
  }
}

// The queue's own writes may use the reserve.
export async function spare<T>(fn: () => Promise<T>): Promise<T> {
  const b = store.getStore();
  if (!b) return fn();
  const was = b.spare;
  b.spare = true;
  try {
    return await fn();
  } finally {
    b.spare = was;
  }
}

// What a call was, without any of the data in it: a database query by its verb and table only (never the values),
// Gmail by method and path, Google sign-in, a phone push by its service, anything else by host and path.
// `write` calls change something; `repeatable` writes (Gmail label changes, mark read) are safe to do twice.
export function describeCall(input: RequestInfo | URL, init?: RequestInit): Pick<CallEntry, "kind" | "what" | "write" | "repeatable"> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers);
  const path = gmailPathOf(url);
  if (path !== null) {
    return { kind: "gmail", what: `${method} ${path}`, write: method !== "GET", repeatable: /\/modify$/.test(path) };
  }
  if (url.hostname === "oauth2.googleapis.com") return { kind: "google", what: "Google sign-in refresh", write: false };
  if (headers.get("content-encoding") === "aes128gcm") return { kind: "push", what: `Push via ${url.hostname}`, write: true, repeatable: true };
  if (typeof init?.body === "string" && headers.get("neon-connection-string") !== null) return { kind: "db", ...sqlWhat(init.body) };
  return { kind: "other", what: `${method} ${url.hostname}${url.pathname}`, write: method !== "GET" };
}

// Neon's HTTP body is {query, params} or {queries: [...]}; only the statement's first words are kept.
function sqlWhat(body: string): { what: string; write: boolean } {
  let queries: string[] = [];
  try {
    const b = JSON.parse(body) as { query?: string; queries?: { query: string }[] };
    queries = b.queries ? b.queries.map((q) => q.query) : [b.query ?? ""];
  } catch {
    return { what: "query", write: true };
  }
  const parts = queries.map((q) => {
    const s = q.replace(/\s+/g, " ").trim();
    const m = /^(insert into|update|delete from)\s+"?(\w+)"?/i.exec(s);
    if (m) return { what: `${m[1]!.split(" ")[0]!.toLowerCase()} ${m[2]}`, write: true };
    const from = /\bfrom\s+"?(\w+)"?/i.exec(s)?.[1];
    if (/^select\b/i.test(s)) return { what: `select ${from ?? ""}`.trim(), write: false };
    // CTEs and anything else: a change if it says so.
    const write = /\b(insert|update|delete)\b/i.test(s);
    return { what: `${s.split(" ")[0]!.toLowerCase()}${from ? ` ${from}` : ""}${write ? " (changes)" : ""}`, write };
  });
  return { what: parts.map((p) => p.what).join(" + "), write: parts.some((p) => p.write) };
}

const MAX_ENTRIES = 500;

// Wraps the global fetch once (worker.ts, dev.ts): Neon's HTTP driver and the Gmail client both call it.
let installed = false;
export function installCallCounter() {
  if (installed) return;
  installed = true;
  const base = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const b = store.getStore();
    if (!b) return base(input, init);
    const started = Date.now();
    const entry: CallEntry = { at: started - b.startedAt, ms: 0, ...describeCall(input, init), ok: false, ...(b.job ? { job: b.job } : {}), ...(b.inner ? { inner: b.inner } : {}) };
    if (b.log.length < MAX_ENTRIES) b.log.push(entry);
    if (b.used >= b.limit - (b.spare ? 0 : b.reserve)) {
      b.ranOut = true;
      entry.error = "Not made: this run's calls ran out";
      return Promise.reject(new OutOfCalls());
    }
    b.used++;
    return base(input, init).then(
      (res) => {
        entry.ms = Date.now() - started;
        entry.ok = res.ok;
        entry.status = res.status;
        if (!res.ok) entry.error = `Answered ${res.status}`;
        return res;
      },
      (e: unknown) => {
        entry.ms = Date.now() - started;
        entry.error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        throw e;
      },
    );
  }) as typeof fetch;
}

// OutOfCalls arrives wrapped (Neon: "Error connecting to database", sourceError; Drizzle: cause), and Cloudflare's
// own limit says "Too many subrequests".
export function isOutOfCalls(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 6; i++) {
    if (x instanceof OutOfCalls) return true;
    if (x instanceof Error && /Too many subrequests/i.test(x.message)) return true;
    const o = x as { sourceError?: unknown; cause?: unknown };
    x = o.sourceError ?? o.cause;
  }
  return false;
}
