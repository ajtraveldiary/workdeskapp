import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clearSavedData } from "./queryClient";
import type { AuditEvent, EmailContent, Label, RangeTasks, EmailState, Me, MutedSender, Report, Summary, Task, TaskView, Thread } from "../shared/types";
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

// Always re-checked on load (cheap), so an expired sign-in is noticed even when a saved copy exists.
export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), retry: false, staleTime: 0 });

export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/summary") });

export type ThreadFilter = { state: EmailState | "all"; unread?: boolean; q?: string; label?: string; limit?: number };
export const useThreads = (f: ThreadFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["threads", f],
    queryFn: () =>
      api<{ threads: Thread[]; counts: Partial<Record<EmailState, number>>; hiddenPending: number }>(
        `/threads${qs({ state: f.state, unread: f.unread && "1", q: f.q, label: f.label, limit: f.limit ? String(f.limit) : undefined })}`,
      ),
    placeholderData: (prev) => prev,
  });

export type TaskFilter = { view: TaskView; q?: string; label?: string };
export const useTasks = (f: TaskFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["tasks", f],
    queryFn: () => api<{ tasks: Task[]; today: string }>(`/tasks${qs({ view: f.view, q: f.q, label: f.label })}`),
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

// --- Mutations: every one refreshes all lists, since an action can move items between screens ---

function useAction<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "labels" }),
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

export const useCreateTask = () => useAction((input: TaskInput) => api(`/tasks`, { method: "POST", body: input }));
export const useUpdateTask = () =>
  useAction(({ id, input }: { id: string; input: Partial<TaskInput> }) => api(`/tasks/${id}`, { method: "PATCH", body: input }));
export const useCompleteTask = () => useAction((id: string) => api(`/tasks/${id}/complete`, { method: "POST" }));
export const useReopenTask = () => useAction((id: string) => api(`/tasks/${id}/reopen`, { method: "POST" }));

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

// --- Settings > Mail: senders hidden from Pending ---

export const useMutedSenders = () =>
  useQuery({ queryKey: ["muted-senders"], queryFn: () => api<{ senders: MutedSender[] }>("/muted-senders"), select: (d) => d.senders });

// Changing the list changes what Pending shows, so the email lists and counts refresh too.
export function useMutedSenderActions() {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all(["muted-senders", "threads", "summary", "history"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    add: useMutation({ mutationFn: (pattern: string) => api<MutedSender>(`/muted-senders`, { method: "POST", body: { pattern } }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/muted-senders/${id}`, { method: "DELETE" }), onSettled: refresh }),
  };
}

// --- Gmail labels ---

type LabelsResponse = { labels: Label[]; canEdit: boolean; syncedAt: string | null };
export const useLabels = () => useQuery({ queryKey: ["labels"], queryFn: () => api<LabelsResponse>("/labels") });

type LabelColorValue = { backgroundColor: string; textColor: string } | null;

// Label changes happen in Gmail; afterwards the label list and every email list refresh.
export function useLabelActions() {
  const qc = useQueryClient();
  const refresh = () => Promise.all(["labels", "threads", "tasks", "reports", "summary", "history"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    reload: useMutation({ mutationFn: () => api<LabelsResponse>("/labels?refresh=1"), onSuccess: (d) => qc.setQueryData(["labels"], d), onSettled: refresh }),
    create: useMutation({ mutationFn: (input: { name: string; color: LabelColorValue }) => api<{ id: string }>("/labels", { method: "POST", body: input }), onSettled: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; color?: LabelColorValue }) => api(`/labels/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
      onSettled: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/labels/${encodeURIComponent(id)}`, { method: "DELETE" }), onSettled: refresh }),
  };
}

// Settings > Mail: the task label and the done label.
type TaskLabelSettings = { taskLabelId: string | null; doneLabelId: string | null };
export const useTaskLabelSettings = () =>
  useQuery({ queryKey: ["task-label-settings"], queryFn: () => api<TaskLabelSettings>("/labels/task-settings") });

// Choosing a label turns the emails that have it into tasks, so every list refreshes afterwards.
export function useSetTaskLabelSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskLabelSettings) =>
      api<{ created: number; completed: number; queued: number }>("/labels/task-settings", { method: "PUT", body: input }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "labels" }),
  });
}

export function useSetThreadLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, add, remove }: { id: string; add: string[]; remove: string[] }) =>
      api(`/threads/${id}/labels`, { method: "PUT", body: { add, remove } }),
    // Tasks from an email show the email's labels, so task lists refresh too.
    onSettled: () => Promise.all(["threads", "tasks", "summary", "history"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

// One conversation, e.g. the email a task came from.
export const useThread = (id: string | null) =>
  useQuery({ queryKey: ["thread", id], queryFn: () => api<Thread>(`/threads/${id}`), enabled: !!id });

// --- Email viewer ---

// Keyed by the conversation's latest-message time: a given version never changes, so it is fetched from
// Gmail once and then served from the browser's HTTP cache (not saved to localStorage; emails can be large).
export const useEmailContent = (thread: Pick<Thread, "id" | "lastMessageAt"> | null) => {
  const version = thread ? new Date(thread.lastMessageAt).getTime() : 0;
  return useQuery({
    queryKey: ["email-content", thread?.id, version],
    queryFn: () => api<EmailContent>(`/threads/${thread!.id}/content?v=${version}`),
    enabled: !!thread,
    staleTime: Infinity,
  });
};

// Marks an opened email read (in Gmail and here). Answers { marked: false, reason: "permission" } when the
// account signed in before this permission existed.
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ marked: boolean; reason?: "permission" }>(`/threads/${id}/read`, { method: "POST" }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["threads"] }), qc.invalidateQueries({ queryKey: ["summary"] })]),
  });
}

export const attachmentUrl = (threadId: string, messageId: string, partId: string, download = false) =>
  `/api/threads/${threadId}/messages/${encodeURIComponent(messageId)}/parts/${encodeURIComponent(partId)}${download ? "?download=1" : ""}`;

// --- Reports ---

export const useReports = () =>
  useQuery({ queryKey: ["reports"], queryFn: () => api<{ reports: Report[]; today: string }>("/reports") });

// Report changes create or complete tasks, so every list refreshes (useAction invalidates all but the label list).
export const useCreateReport = () => useAction((input: ReportInput) => api(`/reports`, { method: "POST", body: input }));
export const useUpdateReport = () =>
  useAction(({ id, input }: { id: string; input: Partial<ReportInput> }) => api(`/reports/${id}`, { method: "PATCH", body: input }));
export const useDeleteReport = () => useAction((id: string) => api(`/reports/${id}`, { method: "DELETE" }));
export const useSetPeriodStatus = () =>
  useAction(({ id, submitted }: { id: string; submitted: boolean }) =>
    api(`/reports/periods/${id}/${submitted ? "submit" : "reopen"}`, { method: "POST" }),
  );

// Signing out also clears the copy saved in this browser.
export const logout = () => api(`/auth/logout`, { method: "POST" }).finally(clearSavedData);
