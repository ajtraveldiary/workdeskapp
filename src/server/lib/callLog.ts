// Calls log and saved changes (user request 2026-10-23, "every subrequest made from any part of this website must be
// logged in this queue, and if failed stored there for retry"). A request's calls are collected by the counter
// (callBudget.ts) and written here as one row at the end, from the reserve, so logging never costs the request its
// own calls. A change (POST / PUT / PATCH / DELETE) that fails with a server error or runs out of calls is saved as an
// `action` job: tried again automatically when nothing was saved before it failed, otherwise left for the user's
// check (Settings › Queue), so nothing is made twice. Reads are only logged: the screen asks again.
import type { DB } from "../db";
import { callLogs, jobs } from "../db/schema";
import { requestTitle, retryDelayMinutes } from "../../shared/jobs";
import type { CallEntry } from "../../shared/types";
import { spare, type CallBudget } from "./callBudget";

// Changes never saved to be done again (still logged): passwords, sign-in secrets, device keys, large imports, the
// assistant's own endpoint (it retries itself) and the queue's and sync's own buttons (they are queue work already).
const NOT_SAVED: [RegExp, string][] = [
  [/^\/api\/logins/, "it holds a password"],
  [/^\/api\/(oauth|auth)\//, "sign-in details aren't kept"],
  [/^\/api\/push\/subscribe/, "device keys aren't kept"],
  [/^\/api\/transfer\//, "import the file again"],
  [/^\/api\/mcp/, "the assistant tries again itself"],
  [/^\/api\/(queue|sync|maintain)\b/, "it is queue work already"],
];
const MAX_BODY = 100_000;

export const isChange = (method: string) => method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

// Why a failed change can't be saved, or null when it can.
export function notSavedReason(path: string) {
  return NOT_SAVED.find(([re]) => re.test(path))?.[1] ?? null;
}

// Changes that went through before the failure (Gmail label changes and mark-read are safe to do again, so they
// don't count).
export const savedBefore = (entries: CallEntry[]) => entries.filter((e) => e.ok && e.write && !e.repeatable);

export type FailedChange = { userId: string; method: string; path: string; body: string | null; from: "app" | "assistant"; entries: CallEntry[]; error: string };

// Saves a failed change as a job; returns it with whether it waits for the user's check.
export async function saveFailedChange(db: DB, f: FailedChange, callLogId: string) {
  const saved = savedBefore(f.entries);
  const check = saved.length > 0;
  const title = requestTitle(f.method, f.path);
  const note = check
    ? `Part of it was saved before it failed (${[...new Set(saved.map((e) => e.what))].join(", ")}). Check it, then Retry or Discard. Failed: ${f.error}`
    : `Failed: ${f.error}. Nothing was saved; it is tried again automatically.`;
  const [job] = await spare(() =>
    db
      .insert(jobs)
      .values({
        userId: f.userId,
        kind: "action",
        status: check ? "check" : "queued",
        runAfter: new Date(Date.now() + retryDelayMinutes(1) * 60_000),
        title,
        note: note.slice(0, 600),
        payload: { method: f.method, path: f.path, body: f.body && f.body.length <= MAX_BODY ? f.body : null, from: f.from },
        callLogId,
      })
      .returning({ id: jobs.id }),
  );
  return { jobId: job!.id, check, title };
}

export type LogMeta = { id?: string; userId: string | null; source: "app" | "schedule" | "assistant"; method: string; path: string; status: number | null; jobId?: string | null };

// One row for the request or run. Nothing is written for one that made no calls. A failure to write goes to the
// Worker's own log and never fails the request.
export async function writeCallLog(db: DB, b: CallBudget, m: LogMeta) {
  if (!b.log.length) return;
  const failed = b.log.filter((e) => !e.ok).length;
  try {
    await spare(() =>
      db.insert(callLogs).values({
        id: m.id ?? crypto.randomUUID(),
        userId: m.userId,
        source: m.source,
        request: `${m.method} ${m.path}`.slice(0, 300),
        status: m.status,
        startedAt: new Date(b.startedAt),
        ms: Date.now() - b.startedAt,
        calls: b.used,
        limit: Number.isFinite(b.limit) ? b.limit : null,
        failed,
        ranOut: b.ranOut,
        selfCheck: m.method === "GET" && /^\/api\/queue\b/.test(m.path),
        jobId: m.jobId ?? null,
        entries: b.log,
      }),
    );
  } catch (e) {
    console.error("Calls log not written:", e);
  }
}
