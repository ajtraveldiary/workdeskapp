// The latest database problem the server reported (Neon paused by a usage limit, or unreachable), for the
// pop-up in App.tsx (user request 2026-10-06). Set from the query client whenever a request fails with one.
import { useSyncExternalStore } from "react";

export type DbIssue = { code: "database_paused" | "database_error"; message: string; detail?: string };

let current: DbIssue | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function isDbIssue(e: unknown): e is { code: DbIssue["code"]; message: string; detail?: string } {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "database_paused" || code === "database_error";
}

export function reportDbIssue(e: unknown) {
  if (!isDbIssue(e)) return;
  current = { code: e.code, message: e.message, detail: e.detail };
  emit();
}

export function clearDbIssue() {
  current = null;
  emit();
}

export function useDbIssue() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}
