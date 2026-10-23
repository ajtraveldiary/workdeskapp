// Calls budget (user request 2026-10-23, "Too many subrequests"): a Cloudflare Worker run may make only so many
// outgoing calls (50 on the free plan), and every Neon query and Gmail request is one. Inside a budget the counter
// refuses the next call with OutOfCalls once only the reserve is left, so the queue (lib/queue.ts) can still write
// down where it stopped and carry on in the next run, instead of Cloudflare failing every call that follows.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Env } from "../env";

export type CallBudget = {
  limit: number;
  used: number;
  // Kept back for the queue's own bookkeeping; only `spare` may use it.
  reserve: number;
  spare: boolean;
  // Set once a call was refused, so work that swallowed the error is still known to be unfinished.
  ranOut: boolean;
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

export const newBudget = (limit: number, reserve = 3): CallBudget => ({ limit, used: 0, reserve, spare: false, ranOut: false });

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

// Wraps the global fetch once (worker.ts, dev.ts): Neon's HTTP driver and the Gmail client both call it.
let installed = false;
export function installCallCounter() {
  if (installed) return;
  installed = true;
  const base = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const b = store.getStore();
    if (b) {
      if (b.used >= b.limit - (b.spare ? 0 : b.reserve)) {
        b.ranOut = true;
        return Promise.reject(new OutOfCalls());
      }
      b.used++;
    }
    return base(input, init);
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
