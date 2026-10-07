// Deleting tasks from the To-do card (user request 2026-10-07): after the confirm, the tasks disappear at once
// and the Undo bar shows for 5 seconds; they are only deleted on the server if Undo isn't tapped (or when
// the app is closed or hidden in the meantime, so a deletion is never lost). Reminder tasks are left out by
// the caller (and skipped by the server).
import { useSyncExternalStore } from "react";
import { showUndo } from "./components/SwipeRow";
import { queryClient } from "./queryClient";

let hidden = new Set<string>();
const listeners = new Set<() => void>();
const setHidden = (next: Set<string>) => {
  hidden = next;
  listeners.forEach((l) => l());
};

export function useHiddenTasks() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => hidden,
    () => hidden,
  );
}

let pending: string[] | null = null;

async function commit(ids: string[]) {
  try {
    await fetch("/api/tasks/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      credentials: "same-origin",
      keepalive: true, // still sent if the app is being closed
    });
  } finally {
    await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "labels" });
    setHidden(new Set([...hidden].filter((id) => !ids.includes(id))));
  }
}

function flush() {
  if (!pending) return;
  const ids = pending;
  pending = null;
  void commit(ids);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

export function deleteTasksWithUndo(ids: string[]) {
  if (ids.length === 0) return;
  flush();
  pending = ids;
  setHidden(new Set([...hidden, ...ids]));
  showUndo({
    message: ids.length === 1 ? "Task deleted" : `${ids.length} tasks deleted`,
    onUndo: () => {
      if (pending !== ids) return;
      pending = null;
      setHidden(new Set([...hidden].filter((id) => !ids.includes(id))));
    },
    onExpire: () => {
      if (pending === ids) flush();
    },
  });
}
