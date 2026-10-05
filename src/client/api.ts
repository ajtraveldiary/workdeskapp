import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditEvent, Category, RangeTasks, EmailState, Me, Report, Summary, Task, TaskView, Thread } from "../shared/types";
import type { ReportInput, TaskInput } from "../shared/schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const qs = (params: Record<string, string | undefined | false>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

// --- Queries ---

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), retry: false });

export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/summary") });

export type ThreadFilter = { state: EmailState | "all"; unread?: boolean; q?: string; category?: string };
export const useThreads = (f: ThreadFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["threads", f],
    queryFn: () =>
      api<{ threads: Thread[]; counts: Partial<Record<EmailState, number>> }>(
        `/threads${qs({ state: f.state, unread: f.unread && "1", q: f.q, category: f.category })}`,
      ),
    placeholderData: (prev) => prev,
  });

export type TaskFilter = { view: TaskView; q?: string; category?: string };
export const useTasks = (f: TaskFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["tasks", f],
    queryFn: () => api<{ tasks: Task[]; today: string }>(`/tasks${qs({ view: f.view, q: f.q, category: f.category })}`),
    placeholderData: (prev) => prev,
  });

export const useRangeTasks = (from: string, to: string) =>
  useQuery({
    queryKey: ["tasks", "range", from, to],
    queryFn: () => api<RangeTasks>(`/tasks/range${qs({ from, to })}`),
    placeholderData: (prev) => prev,
  });

export const useHistory = (f: { type?: string; q?: string }) =>
  useQuery({
    queryKey: ["history", f],
    queryFn: () => api<{ events: AuditEvent[] }>(`/history${qs({ type: f.type, q: f.q })}`),
    placeholderData: (prev) => prev,
  });

export const useCategories = () =>
  useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ categories: Category[] }>("/categories"),
    select: (d) => d.categories,
    staleTime: 5 * 60_000,
  });

// --- Mutations: every one refreshes all lists, since an action can move items between screens ---

function useAction<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "categories" }),
  });
}

export const useCreateTaskFromThread = () =>
  useAction(({ threadId, input }: { threadId: string; input: TaskInput }) =>
    api(`/threads/${threadId}/task`, { method: "POST", body: input }),
  );
export const useDismiss = () => useAction((id: string) => api(`/threads/${id}/dismiss`, { method: "POST" }));
export const useBulkDismiss = () =>
  useAction((ids: string[]) => api<{ dismissed: number }>(`/threads/bulk-dismiss`, { method: "POST", body: { ids } }));
export const useRestore = () => useAction((id: string) => api(`/threads/${id}/restore`, { method: "POST" }));
export const useSnooze = () =>
  useAction(({ id, until }: { id: string; until: Date }) =>
    api(`/threads/${id}/snooze`, { method: "POST", body: { until: until.toISOString() } }),
  );
export const useMarkSeen = () => useAction((id: string) => api(`/threads/${id}/seen`, { method: "POST" }));
export const useSetThreadCategory = () =>
  useAction(({ id, categoryId }: { id: string; categoryId: string | null }) =>
    api(`/threads/${id}`, { method: "PATCH", body: { categoryId } }),
  );

export const useCreateTask = () => useAction((input: TaskInput) => api(`/tasks`, { method: "POST", body: input }));
export const useUpdateTask = () =>
  useAction(({ id, input }: { id: string; input: Partial<TaskInput> }) => api(`/tasks/${id}`, { method: "PATCH", body: input }));
export const useCompleteTask = () => useAction((id: string) => api(`/tasks/${id}/complete`, { method: "POST" }));
export const useReopenTask = () => useAction((id: string) => api(`/tasks/${id}/reopen`, { method: "POST" }));

export function useCategoryActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["categories"] });
  return {
    add: useMutation({ mutationFn: (name: string) => api(`/categories`, { method: "POST", body: { name } }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/categories/${id}`, { method: "DELETE" }), onSettled: refresh }),
  };
}

// Sync drains Gmail in batches; keep calling until nothing is left.
export function useSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      let total = 0;
      for (let i = 0; i < 40; i++) {
        const r = await api<{ fetched: number; remaining: number }>(`/sync`, { method: "POST" });
        total += r.fetched;
        if (r.remaining === 0) break;
      }
      return total;
    },
    onSettled: () => qc.invalidateQueries(),
  });
}

// --- Reports ---

export const useReports = () =>
  useQuery({ queryKey: ["reports"], queryFn: () => api<{ reports: Report[]; today: string }>("/reports") });

// Report changes create or complete tasks, so every list refreshes (useAction invalidates all but categories).
export const useCreateReport = () => useAction((input: ReportInput) => api(`/reports`, { method: "POST", body: input }));
export const useUpdateReport = () =>
  useAction(({ id, input }: { id: string; input: Partial<ReportInput> }) => api(`/reports/${id}`, { method: "PATCH", body: input }));
export const useDeleteReport = () => useAction((id: string) => api(`/reports/${id}`, { method: "DELETE" }));
export const useSetPeriodStatus = () =>
  useAction(({ id, submitted }: { id: string; submitted: boolean }) =>
    api(`/reports/periods/${id}/${submitted ? "submit" : "reopen"}`, { method: "POST" }),
  );

export const logout = () => api(`/auth/logout`, { method: "POST" });
