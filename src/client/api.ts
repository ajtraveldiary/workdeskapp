import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { noteNetworkError, noteResponse } from "./connection";
import { clearSavedData } from "./queryClient";
import type { AuditEvent, EmailContent, Label, RangeTasks, EmailState, Me, MutedSender, OfficeFile, Report, RetiringEmployee, StaffList, Summary, Task, TaskView, Thread } from "../shared/types";
import type { EmployeeInput, OfficeFileInput, ReportInput, TaskInput } from "../shared/schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // Set for database problems ("database_paused" / "database_error"), with the database's own message.
    readonly code?: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
    });
  } catch (e) {
    noteNetworkError(); // no connection: the title bar shows offline (connection.ts)
    throw e;
  }
  // Answered from the copy saved for offline use (service worker), or by the server.
  noteResponse(res.headers.get("x-workdesk-offline") === "1");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; code?: string; detail?: string };
    throw new ApiError(d.error ?? `Request failed (${res.status})`, res.status, d.code, d.detail);
  }
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

function useAction<V, R = unknown>(fn: (v: V) => Promise<R>) {
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
// Remove → Send to a section (user request 2026-10-07): adds the section's label (Gmail too) and moves the emails
// to Other sections; undo: true takes it off again.
export const useSendToSection = () =>
  useAction((input: { ids: string[]; labelId: string; undo?: boolean; previous?: { id: string; state: "needs_decision" | "elsewhere"; sectionLabelId: string | null }[] }) => api<{ moved: number }>(`/threads/bulk-section`, { method: "POST", body: input }));
// Bulk actions for the list toolbars.
export const useBulkTask = () => useAction((ids: string[]) => api<{ created: number }>(`/threads/bulk-task`, { method: "POST", body: { ids } }));
export const useBulkRestore = () => useAction((ids: string[]) => api<{ restored: number }>(`/threads/bulk-restore`, { method: "POST", body: { ids } }));
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

// Hidden text (Settings > Mail): snippets left out of the email reader and of shared emails.
// Downloaded once and kept with the saved copy (user request 2026-10-06): every email is checked against this
// local list, so reading emails never asks the server for it. It is fetched again only after the list is
// changed in Settings (or Settings is refreshed), or when the saved copy expires (CACHE_MAX_AGE).
// Private calendar link for Apple Calendar etc. (user request 2026-10-07).
export const useCalendarLink = () => useQuery({ queryKey: ["calendar-link"], queryFn: () => api<{ url: string | null }>("/calendar-link") });
export function useCalendarLinkActions() {
  const qc = useQueryClient();
  const set = (d: { url: string | null }) => {
    qc.setQueryData(["calendar-link"], d);
    void qc.invalidateQueries({ queryKey: ["history"] });
  };
  return {
    make: useMutation({ mutationFn: () => api<{ url: string }>("/calendar-link", { method: "POST" }), onSuccess: set }),
    off: useMutation({ mutationFn: () => api<{ url: null }>("/calendar-link", { method: "DELETE" }), onSuccess: set }),
  };
}

// Staff page (user request 2026-10-07): designations and employees, kept for a day on the device (it changes
// rarely; every change here refetches it).
export const useStaff = () => useQuery({ queryKey: ["staff"], queryFn: () => api<StaffList>("/staff"), staleTime: 24 * 3600_000 });
export const useEmployeeWork = (id: string | null) =>
  useQuery({
    queryKey: ["staff-work", id],
    enabled: !!id,
    queryFn: () => api<{ tasks: Task[]; reminders: { id: string; name: string; active: boolean; relatedKind: string }[]; today: string }>(`/staff/employees/${id}/work`),
  });
// Retiring within 12 months, with each one's Pension papers task (user request 2026-10-08). Task changes
// refetch it (they refresh everything but labels); so do staff changes ("staff" prefix).
export const useRetiring = () => useQuery({ queryKey: ["staff", "retiring"], queryFn: () => api<{ today: string; retiring: RetiringEmployee[] }>("/staff/retiring") });
export function useStaffActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "staff" || q.queryKey[0] === "history" });
  const m = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSettled: refresh });
  return {
    addDesignation: m((name: string) => api<{ id: string }>("/staff/designations", { method: "POST", body: { name } })),
    addCommon: m(() => api<{ added: number }>("/staff/designations/common", { method: "POST" })),
    renameDesignation: m(({ id, name }: { id: string; name: string }) => api(`/staff/designations/${id}`, { method: "PATCH", body: { name } })),
    moveDesignation: m(({ id, by }: { id: string; by: number }) => api(`/staff/designations/${id}/move`, { method: "POST", body: { by } })),
    removeDesignation: m((id: string) => api(`/staff/designations/${id}`, { method: "DELETE" })),
    // Types of temporary employees (user request 2026-10-07).
    addType: m((name: string) => api<{ id: string }>("/staff/types", { method: "POST", body: { name } })),
    addCommonTypes: m(() => api<{ added: number }>("/staff/types/common", { method: "POST" })),
    renameType: m(({ id, name }: { id: string; name: string }) => api(`/staff/types/${id}`, { method: "PATCH", body: { name } })),
    moveType: m(({ id, by }: { id: string; by: number }) => api(`/staff/types/${id}/move`, { method: "POST", body: { by } })),
    removeType: m((id: string) => api(`/staff/types/${id}`, { method: "DELETE" })),
    addEmployee: m((input: EmployeeInput) => api<{ id: string }>("/staff/employees", { method: "POST", body: input })),
    saveEmployee: m(({ id, input }: { id: string; input: EmployeeInput }) => api(`/staff/employees/${id}`, { method: "PUT", body: input })),
    setLeft: m(({ id, left }: { id: string; left: boolean }) => api(`/staff/employees/${id}/left`, { method: "POST", body: { left } })),
    removeEmployee: m((id: string) => api(`/staff/employees/${id}`, { method: "DELETE" })),
  };
}
// File register (user request 2026-10-07).
export const useOfficeFiles = () => useQuery({ queryKey: ["files"], queryFn: () => api<{ files: OfficeFile[] }>("/files") });
export function useOfficeFileActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "files" || q.queryKey[0] === "history" });
  return {
    add: useMutation({ mutationFn: (input: OfficeFileInput) => api<OfficeFile>("/files", { method: "POST", body: input }), onSettled: refresh }),
    save: useMutation({ mutationFn: ({ id, input }: { id: string; input: OfficeFileInput }) => api(`/files/${id}`, { method: "PUT", body: input }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/files/${id}`, { method: "DELETE" }), onSettled: refresh }),
  };
}

// Increment done (user request 2026-10-07): the date moves a year on; undoTo puts the old date back.
export function useIncrementDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, undoTo }: { id: string; undoTo?: string }) =>
      api<{ previous: string | null; next: string | null }>(`/staff/employees/${id}/increment`, { method: "POST", body: undoTo ? { undoTo } : {} }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => ["staff", "summary", "history"].includes(q.queryKey[0] as string) }),
  });
}

// Contract ending (user request 2026-10-08): renew for the same period, or ended (left on the end date).
export function useContractAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, undoTo, undo }: { id: string; action: "renew" | "ended"; undoTo?: string; undo?: boolean }) =>
      api<{ previous?: string | null; next?: string | null; leftOn?: string | null }>(`/staff/employees/${id}/contract/${action}`, {
        method: "POST",
        body: action === "renew" ? (undoTo ? { undoTo } : {}) : undo ? { undo: true } : {},
      }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => ["staff", "summary", "history"].includes(q.queryKey[0] as string) }),
  });
}

// Phone notifications (user request 2026-10-07): the settings apply to every device; on/off is per device.
export type PushSettings = { publicKey: string; summaryOn: boolean; summaryTime: string; dueOn: boolean; devices: number };
export const usePushSettings = () => useQuery({ queryKey: ["push"], queryFn: () => api<PushSettings>("/push") });
export function useSavePushSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<PushSettings, "summaryOn" | "summaryTime" | "dueOn">) => api("/push/settings", { method: "PUT", body: input }),
    onMutate: (input) => qc.setQueryData<PushSettings>(["push"], (d) => (d ? { ...d, ...input } : d)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["push"] }),
  });
}
export const pushApi = {
  subscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string }; device: string }) => api("/push/subscribe", { method: "POST", body }),
  unsubscribe: (endpoint: string) => api("/push/unsubscribe", { method: "POST", body: { endpoint } }),
  test: (endpoint?: string) => api<{ sent: number }>("/push/test", { method: "POST", body: { endpoint } }),
};

export const useSnippets = () =>
  useQuery({
    queryKey: ["snippets"],
    queryFn: () => api<{ snippets: { id: string; text: string }[] }>("/snippets"),
    select: (d) => d.snippets,
    staleTime: Infinity,
  });
export function useSnippetActions() {
  const qc = useQueryClient();
  const refresh = () => Promise.all(["snippets", "history"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    add: useMutation({ mutationFn: (text: string) => api<{ id: string; text: string }>(`/snippets`, { method: "POST", body: { text } }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/snippets/${id}`, { method: "DELETE" }), onSettled: refresh }),
  };
}

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
type TaskLabelSettings = { taskLabelId: string | null; doneLabelId: string | null; autoDoneLabelIds: string[]; organizeLabelIds: string[] };
export const useTaskLabelSettings = () =>
  useQuery({ queryKey: ["task-label-settings"], queryFn: () => api<TaskLabelSettings>("/labels/task-settings") });

// Choosing a label turns the emails that have it into tasks, so every list refreshes afterwards.
export function useSetTaskLabelSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskLabelSettings) =>
      api<{ created: number; completed: number; queued: number; labelled: number; toLabel: number; toSections: number; fromSections: number }>("/labels/task-settings", { method: "PUT", body: input }),
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
export const logout = () =>
  api(`/auth/logout`, { method: "POST" }).finally(() => {
    void clearSavedData();
    // The offline copies of emails and lists go too (service worker data cache).
    void globalThis.caches?.delete("workdesk-data").catch(() => undefined);
  });
