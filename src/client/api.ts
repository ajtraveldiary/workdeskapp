import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { noteNetworkError, noteResponse } from "./connection";
import { clearSavedData } from "./queryClient";
import type { MoveKind, StepState } from "../shared/moves";
import type { AuditEvent, EmailContent, EmployeeProfile, Label, RangeTasks, EmailState, Me, MutedSender, OfficeEvent,
  AssistantInfo, AssistantUnseen, CallLog, QueueInfo, QueueRunReport, EventType, StaffMove, Register, RegisterEntry, LinkedEmail, OfficeFile, Report, SiteLogin, Tag, RetiringEmployee, StaffList, Summary, Task, TaskView, Thread } from "../shared/types";
import type { EmployeeInput, EntryInput, OfficeProfile, EventInput, OfficeFileInput, ReportInput, SiteLoginInput, TaskInput, LeaveInput, LeaveLineInput, LeavePatch, LeaveSurrenderInput, LeaveTypeInput } from "../shared/schemas";
import type { EmployeeLeave, LeaveAccount, LeaveCreditPlan, LeavePostponed, LeaveType } from "../shared/types";
import type { AttendanceMonth, Holiday } from "../shared/types";
import type { AttendanceMark, AttendanceSettings } from "../shared/attendance";

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
// Which employee the user is (Settings > Employees, user request 2026-10-12).
export function useSetMeEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: string | null) => api("/me/employee", { method: "PUT", body: { employeeId } }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "me" || q.queryKey[0] === "history" }),
  });
}

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

export type TaskFilter = { view: TaskView; q?: string; label?: string; tag?: string };
export const useTasks = (f: TaskFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["tasks", f],
    queryFn: () => api<{ tasks: Task[]; today: string }>(`/tasks${qs({ view: f.view, q: f.q, label: f.label, tag: f.tag })}`),
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

// Office details (user request 2026-10-19, Settings › General).
export const useOfficeProfile = () => useQuery({ queryKey: ["office-profile"], queryFn: () => api<{ profile: OfficeProfile; updatedAt: string | null }>("/office-profile") });
export function useSaveOfficeProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: OfficeProfile) => api("/office-profile", { method: "PUT", body: p }),
    onSuccess: (_r, p) => {
      qc.setQueryData(["office-profile"], { profile: p, updatedAt: new Date().toISOString() });
      void qc.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

// Settings › Assistant (MCP server, user request 2026-10-18): the address to connect, connected assistants and
// the assistant log (older entries with ?before=).
// changesOnly: the log's "Changes only" filter (Phase 3).
export const useAssistant = (changesOnly = false) =>
  useQuery({ queryKey: ["assistant", { changesOnly }], queryFn: () => api<AssistantInfo>(`/assistant${changesOnly ? "?changes=1" : ""}`), placeholderData: (prev) => prev });
export const olderAssistantLog = (before: string, changesOnly = false) => api<AssistantInfo>(`/assistant?before=${encodeURIComponent(before)}${changesOnly ? "&changes=1" : ""}`);
// The bell (Phase 5, user request 2026-10-19): assistant changes not looked at yet; "seen" clears them.
// Assistants change things outside the app, so it is checked again after a minute (and when the app comes back).
export const useAssistantUnseen = () => useQuery({ queryKey: ["assistant-unseen"], queryFn: () => api<AssistantUnseen>("/assistant/unseen"), staleTime: 60_000, refetchInterval: 5 * 60_000 });
export function useAssistantSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/assistant/seen", { method: "POST" }),
    onSuccess: () => qc.setQueryData<AssistantUnseen>(["assistant-unseen"], { count: 0, latest: [] }),
  });
}
// Allow changes and the hourly limit (Phase 3, user request 2026-10-18).
export function useAssistantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: { allowChanges: boolean; perHour: number; allowStaff: boolean }) => api("/assistant/settings", { method: "PUT", body: s }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["assistant"] }), qc.invalidateQueries({ queryKey: ["history"] })]),
  });
}
export function useDisconnectAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => api(`/assistant/connections/${encodeURIComponent(clientId)}`, { method: "DELETE" }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["assistant"] }), qc.invalidateQueries({ queryKey: ["history"] })]),
  });
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
// An employee's own page (user request 2026-10-08): their tasks, reminders and History. Under "staff", so staff
// changes refresh it; task changes refresh everything but labels.
export const useEmployeeProfile = (id: string) => useQuery({ queryKey: ["staff", "profile", id], queryFn: () => api<EmployeeProfile>(`/staff/employees/${id}/profile`) });
export function useStaffActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "staff" || q.queryKey[0] === "history" });
  const m = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSettled: refresh });
  // Drag and drop (user request 2026-10-08): the list shows the new order at once, then the server saves it.
  const order = (key: "designations" | "types", path: string) =>
    useMutation({
      mutationFn: (ids: string[]) => api(path, { method: "POST", body: { ids } }),
      onMutate: async (ids: string[]) => {
        await qc.cancelQueries({ queryKey: ["staff"], exact: true });
        qc.setQueryData<StaffList>(["staff"], (old) => {
          if (!old) return old;
          const at = new Map(ids.map((id, k) => [id, k]));
          const list = [...old[key]].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
          return { ...old, [key]: list.map((x, k) => ({ ...x, sortOrder: k })) };
        });
      },
      onSettled: refresh,
    });
  return {
    addDesignation: m((name: string) => api<{ id: string }>("/staff/designations", { method: "POST", body: { name } })),
    addCommon: m(() => api<{ added: number }>("/staff/designations/common", { method: "POST" })),
    renameDesignation: m(({ id, name }: { id: string; name: string }) => api(`/staff/designations/${id}`, { method: "PATCH", body: { name } })),
    moveDesignation: m(({ id, by }: { id: string; by: number }) => api(`/staff/designations/${id}/move`, { method: "POST", body: { by } })),
    orderDesignations: order("designations", "/staff/designations/order"),
    removeDesignation: m((id: string) => api(`/staff/designations/${id}`, { method: "DELETE" })),
    // Types of temporary employees (user request 2026-10-07).
    addType: m((name: string) => api<{ id: string }>("/staff/types", { method: "POST", body: { name } })),
    addCommonTypes: m(() => api<{ added: number }>("/staff/types/common", { method: "POST" })),
    renameType: m(({ id, name }: { id: string; name: string }) => api(`/staff/types/${id}`, { method: "PATCH", body: { name } })),
    moveType: m(({ id, by }: { id: string; by: number }) => api(`/staff/types/${id}/move`, { method: "POST", body: { by } })),
    orderTypes: order("types", "/staff/types/order"),
    removeType: m((id: string) => api(`/staff/types/${id}`, { method: "DELETE" })),
    addEmployee: m((input: EmployeeInput) => api<{ id: string }>("/staff/employees", { method: "POST", body: input })),
    saveEmployee: m(({ id, input }: { id: string; input: EmployeeInput }) => api(`/staff/employees/${id}`, { method: "PUT", body: input })),
    setLeft: m(({ id, left }: { id: string; left: boolean }) => api(`/staff/employees/${id}/left`, { method: "POST", body: { left } })),
    removeEmployee: m((id: string) => api(`/staff/employees/${id}`, { method: "DELETE" })),
    // A gazetted post (user request 2026-10-30): its employees' switch follows. Shown at once.
    setGazettedPost: useMutation({
      mutationFn: ({ id, gazetted }: { id: string; gazetted: boolean }) => api(`/staff/designations/${id}/gazetted`, { method: "POST", body: { gazetted } }),
      onMutate: async ({ id, gazetted }) => {
        await qc.cancelQueries({ queryKey: ["staff"], exact: true });
        qc.setQueryData<StaffList>(["staff"], (old) => (old ? { ...old, designations: old.designations.map((d) => (d.id === id ? { ...d, gazetted } : d)) } : old));
      },
      onSettled: refresh,
    }),
  };
}

// Leave (user request 2026-10-30, docs/LEAVE_PLAN.md): the leave types (Settings › Leave) and an employee's leave
// account. Under "leave"; changes also refresh History.
export const useLeaveTypes = () => useQuery({ queryKey: ["leave", "types"], queryFn: () => api<{ types: LeaveType[] }>("/leave/types") });
export const useLeaveAccount = (employeeId: string) =>
  useQuery({ queryKey: ["leave", "account", employeeId], queryFn: () => api<LeaveAccount>(`/leave/accounts/${employeeId}`), enabled: !!employeeId });
// Leaves marked (phase 2): one employee's, or the ones that matter now (on leave, starting soon, due back).
export const useEmployeeLeaves = (employeeId: string) =>
  useQuery({ queryKey: ["leave", "leaves", employeeId], queryFn: () => api<{ today: string; leaves: EmployeeLeave[] }>(`/leave/leaves?employeeId=${employeeId}`) });
// Every leave, newest first (the Leave page's history).
export const useAllLeaves = () => useQuery({ queryKey: ["leave", "leaves", "all"], queryFn: () => api<{ today: string; leaves: EmployeeLeave[] }>("/leave/leaves?all=1") });
export const useCurrentLeaves = () => useQuery({ queryKey: ["leave", "leaves", "now"], queryFn: () => api<{ today: string; leaves: EmployeeLeave[] }>("/leave/leaves") });
export function useLeaveActions() {
  const qc = useQueryClient();
  // Marking leave makes a task, so the task lists refresh too; EOL can move an employee's increment date (staff).
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["leave", "history", "tasks", "summary", "staff"].includes(q.queryKey[0] as string) });
  const m = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSettled: refresh });
  return {
    addType: m((input: LeaveTypeInput) => api<{ id: string }>("/leave/types", { method: "POST", body: input })),
    // A built-in KSR type's figures back to the rule's.
    resetType: m((id: string) => api(`/leave/types/${id}/reset`, { method: "POST" })),
    saveType: m(({ id, input }: { id: string; input: LeaveTypeInput }) => api(`/leave/types/${id}`, { method: "PUT", body: input })),
    removeType: m((id: string) => api(`/leave/types/${id}`, { method: "DELETE" })),
    // Drag and drop: the new order shows at once.
    orderTypes: useMutation({
      mutationFn: (ids: string[]) => api("/leave/types/order", { method: "POST", body: { ids } }),
      onMutate: async (ids: string[]) => {
        await qc.cancelQueries({ queryKey: ["leave", "types"] });
        qc.setQueryData<{ types: LeaveType[] }>(["leave", "types"], (old) => {
          if (!old) return old;
          const at = new Map(ids.map((id, k) => [id, k]));
          return { types: [...old.types].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity)).map((t, k) => ({ ...t, sortOrder: k })) };
        });
      },
      onSettled: refresh,
    }),
    // "Credit now": dryRun shows who gets it.
    credit: m(({ id, ...body }: { id: string; creditFor: string; onDate: string; days: number; note: string; dryRun: boolean }) =>
      api<LeaveCreditPlan & { credited?: number; skipped?: number; lapsed?: number }>(`/leave/types/${id}/credit`, { method: "POST", body }),
    ),
    addLine: m(({ employeeId, input }: { employeeId: string; input: LeaveLineInput }) => api(`/leave/accounts/${employeeId}/lines`, { method: "POST", body: input })),
    markLeave: m((input: LeaveInput) => api<{ id: string; taskId: string; postponed: LeavePostponed }>("/leave/leaves", { method: "POST", body: input })),
    saveLeave: m(({ id, input }: { id: string; input: LeavePatch }) => api(`/leave/leaves/${id}`, { method: "PUT", body: input })),
    cancelLeave: m((id: string) => api(`/leave/leaves/${id}/cancel`, { method: "POST" })),
    // Phase 4: Undo of the dates an EOL moved, and surrender of earned leave.
    undoPostpone: m(({ id, ...body }: LeavePostponed & { id: string }) => api(`/leave/leaves/${id}/postpone/undo`, { method: "POST", body })),
    surrender: m(({ employeeId, input }: { employeeId: string; input: LeaveSurrenderInput }) => api<{ taskId: string }>(`/leave/accounts/${employeeId}/surrender`, { method: "POST", body: input })),
  };
}
// Attendance register (user request 2026-10-31, docs/ATTENDANCE_PLAN.md): a month as the register shows it, the
// year's holidays and the settings (Settings › Attendance). Under "attendance"; changes also refresh History.
export const useAttendance = (month: string) => useQuery({ queryKey: ["attendance", "month", month], queryFn: () => api<AttendanceMonth>(`/attendance?month=${month}`) });
export const useHolidays = (year: string) => useQuery({ queryKey: ["attendance", "holidays", year], queryFn: () => api<{ holidays: Holiday[] }>(`/attendance/holidays?year=${year}`) });
export const useAttendanceSettings = () => useQuery({ queryKey: ["attendance", "settings"], queryFn: () => api<{ settings: AttendanceSettings }>("/attendance/settings") });
export type AttendanceCell = { employeeId: string; date: string };
export function useAttendanceActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["attendance", "history"].includes(q.queryKey[0] as string) });
  const m = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSettled: refresh });
  return {
    mark: m((body: { cells: AttendanceCell[]; mark: Exclude<AttendanceMark, "ch">; replace?: boolean }) =>
      api<{ marked: number; skipped: Record<string, number> }>("/attendance/mark", { method: "POST", body }),
    ),
    clear: m((cells: AttendanceCell[]) => api<{ cleared: number }>("/attendance/clear", { method: "POST", body: { cells } })),
    saveHoliday: m((body: { date: string; name: string }) => api("/attendance/holidays", { method: "POST", body })),
    removeHoliday: m((date: string) => api(`/attendance/holidays/${date}`, { method: "DELETE" })),
    saveSettings: m((body: AttendanceSettings) => api("/attendance/settings", { method: "PUT", body })),
  };
}
// Joining and relieving (user request 2026-10-15). Under "staff", so employee and task changes refresh it.
export const useMoves = () => useQuery({ queryKey: ["staff", "moves"], queryFn: () => api<{ moves: StaffMove[] }>("/moves") });
export function useMoveActions() {
  const qc = useQueryClient();
  // A step is the task's checklist too, and joining / relieving changes the employee: refresh all of them.
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["staff", "tasks", "summary", "history"].includes(q.queryKey[0] as string) });
  return {
    start: useMutation({
      mutationFn: (input: { employeeId: string; kind: MoveKind; date: string; doneSteps?: string[] }) => api<{ id: string; taskId: string }>("/moves", { method: "POST", body: input }),
      onSettled: refresh,
    }),
    // The pill changes at once; the server writes the task's step.
    step: useMutation({
      mutationFn: ({ id, step, state }: { id: string; step: string; state: StepState }) => api(`/moves/${id}/step`, { method: "POST", body: { step, state } }),
      onMutate: async ({ id, step, state }) => {
        await qc.cancelQueries({ queryKey: ["staff", "moves"] });
        qc.setQueryData<{ moves: StaffMove[] }>(["staff", "moves"], (old) =>
          old ? { moves: old.moves.map((m) => (m.id === id ? { ...m, steps: m.steps.map((s) => (s.id === step ? { ...s, state } : s)) } : m)) } : old,
        );
      },
      onSettled: refresh,
    }),
  };
}
// File register (user request 2026-10-07).
export const useOfficeFiles = () => useQuery({ queryKey: ["files"], queryFn: () => api<{ files: OfficeFile[] }>("/files") });
export function useOfficeFileActions() {
  const qc = useQueryClient();
  // Tags (shared with tasks and reminders) count their files, so the tag list refreshes too.
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "files" || q.queryKey[0] === "history" || q.queryKey[0] === "tags" });
  return {
    add: useMutation({ mutationFn: (input: OfficeFileInput) => api<OfficeFile>("/files", { method: "POST", body: input }), onSettled: refresh }),
    save: useMutation({ mutationFn: ({ id, input }: { id: string; input: OfficeFileInput }) => api(`/files/${id}`, { method: "PUT", body: input }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/files/${id}`, { method: "DELETE" }), onSettled: refresh }),
  };
}

// Events: meetings, trainings, programmes (user request 2026-10-11). A change can add or remove prep tasks and move
// an email out of (or back to) Pending, so those lists refresh too.
export const useOfficeEvents = (opts: { enabled?: boolean } = {}) => useQuery({ queryKey: ["office-events"], queryFn: () => api<{ events: OfficeEvent[]; today: string }>("/office-events"), enabled: opts.enabled ?? true });
export type OccurrenceChange = { date: string; status: "scheduled" | "done" | "cancelled" | "moved" | "original"; newDate?: string; newTime?: string | null; newEndTime?: string | null };
export function useOfficeEventActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["office-events", "event-types", "tasks", "summary", "history", "threads", "tags"].includes(q.queryKey[0] as string) });
  return {
    add: useMutation({ mutationFn: (input: EventInput) => api<OfficeEvent>("/office-events", { method: "POST", body: input }), onSettled: refresh }),
    save: useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<EventInput> }) => api(`/office-events/${id}`, { method: "PATCH", body: input }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/office-events/${id}`, { method: "DELETE" }), onSettled: refresh }),
    occurrence: useMutation({ mutationFn: ({ id, ...change }: OccurrenceChange & { id: string }) => api(`/office-events/${id}/occurrence`, { method: "POST", body: change }), onSettled: refresh }),
  };
}
// More emails on a task or an event (user request 2026-10-17).
type EmailOwner = { taskId: string } | { eventId: string };
const ownerQuery = (o: EmailOwner) => ("taskId" in o ? `taskId=${o.taskId}` : `eventId=${o.eventId}`);
export const useLinkedEmails = (o: EmailOwner) =>
  useQuery({ queryKey: ["linked-emails", ownerQuery(o)], queryFn: () => api<{ emails: LinkedEmail[] }>(`/linked-emails?${ownerQuery(o)}`) });
export function useLinkedEmailActions(o: EmailOwner) {
  const qc = useQueryClient();
  // The emails leave or come back to Pending, and their task's state shows on them.
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["linked-emails", "threads", "thread", "tasks", "summary", "history", "office-events"].includes(q.queryKey[0] as string) });
  return {
    add: useMutation({ mutationFn: (threadIds: string[]) => api<{ added: number }>("/linked-emails", { method: "POST", body: { ...o, threadIds } }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (threadId: string) => api(`/linked-emails/${threadId}?${ownerQuery(o)}`, { method: "DELETE" }), onSettled: refresh }),
  };
}
// Registers (user request 2026-10-16): the registers (Settings › Registers) and their pending entries.
export const useRegisters = () => useQuery({ queryKey: ["registers"], queryFn: () => api<{ registers: Register[] }>("/registers") });
export const useRegisterEntries = () => useQuery({ queryKey: ["register-entries"], queryFn: () => api<{ entries: RegisterEntry[] }>("/register-entries") });
// An entry with a due date is a task too, so changes refresh the task lists and counts as well.
const registerRefresh = (qc: ReturnType<typeof useQueryClient>) => () =>
  qc.invalidateQueries({ predicate: (q) => ["registers", "register-entries", "tasks", "summary", "history", "staff"].includes(q.queryKey[0] as string) });
export function useRegisterActions() {
  const qc = useQueryClient();
  const refresh = registerRefresh(qc);
  const m = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSettled: refresh });
  return {
    add: m((name: string) => api<{ id: string }>("/registers", { method: "POST", body: { name } })),
    addCommon: m(async () => ({ added: 0 })),
    rename: m(({ id, name }: { id: string; name: string }) => api(`/registers/${id}`, { method: "PATCH", body: { name } })),
    updatedUntil: m(({ id, date }: { id: string; date: string | null }) => api(`/registers/${id}`, { method: "PATCH", body: { updatedUntil: date } })),
    // Updated until today, and its done entries cleared (user request 2026-10-17).
    markUpdated: m((id: string) => api<{ cleared: number }>(`/registers/${id}/updated`, { method: "POST", body: {} })),
    order: useMutation({
      mutationFn: (ids: string[]) => api("/registers/order", { method: "POST", body: { ids } }),
      onMutate: async (ids: string[]) => {
        await qc.cancelQueries({ queryKey: ["registers"] });
        qc.setQueryData<{ registers: Register[] }>(["registers"], (old) => {
          if (!old) return old;
          const at = new Map(ids.map((id, k) => [id, k]));
          return { registers: [...old.registers].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity)).map((r, k) => ({ ...r, sortOrder: k })) };
        });
      },
      onSettled: refresh,
    }),
    remove: m((id: string) => api(`/registers/${id}`, { method: "DELETE" })),
  };
}
export function useEntryActions() {
  const qc = useQueryClient();
  const refresh = registerRefresh(qc);
  const m = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSettled: refresh });
  return {
    add: m((input: EntryInput) => api<{ id: string; taskId: string | null }>("/register-entries", { method: "POST", body: input })),
    save: m(({ id, input }: { id: string; input: Partial<EntryInput> }) => api(`/register-entries/${id}`, { method: "PATCH", body: input })),
    // Ticked at once on screen; the server follows (and the entry's task with it).
    done: useMutation({
      mutationFn: ({ id, done }: { id: string; done: boolean }) => api(`/register-entries/${id}/done`, { method: "POST", body: { done } }),
      onMutate: async ({ id, done }) => {
        await qc.cancelQueries({ queryKey: ["register-entries"] });
        qc.setQueryData<{ entries: RegisterEntry[] }>(["register-entries"], (old) =>
          old ? { entries: old.entries.map((e) => (e.id === id ? { ...e, status: done ? "done" : "open", doneAt: done ? new Date().toISOString() : null } : e)) } : old,
        );
      },
      onSettled: refresh,
    }),
    remove: m((id: string) => api(`/register-entries/${id}`, { method: "DELETE" })),
  };
}
// Types of events (Settings > Events, user request 2026-10-12), with how many events have each.
export const useEventTypes = () => useQuery({ queryKey: ["event-types"], queryFn: () => api<{ types: EventType[] }>("/event-types") });
export function useEventTypeActions() {
  const qc = useQueryClient();
  // A renamed or deleted type changes how events read everywhere.
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["event-types", "office-events", "summary", "history"].includes(q.queryKey[0] as string) });
  const m = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSettled: refresh });
  return {
    add: m((name: string) => api<{ id: string; name: string }>("/event-types", { method: "POST", body: { name } })),
    addCommon: m(() => api<{ added: number }>("/event-types/common", { method: "POST" })),
    rename: m(({ id, name }: { id: string; name: string }) => api(`/event-types/${id}`, { method: "PATCH", body: { name } })),
    // Drag and drop: the new order shows at once, then the server saves it.
    order: useMutation({
      mutationFn: (ids: string[]) => api("/event-types/order", { method: "POST", body: { ids } }),
      onMutate: async (ids: string[]) => {
        await qc.cancelQueries({ queryKey: ["event-types"] });
        qc.setQueryData<{ types: EventType[] }>(["event-types"], (old) => {
          if (!old) return old;
          const at = new Map(ids.map((id, k) => [id, k]));
          return { types: [...old.types].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity)).map((t, k) => ({ ...t, sortOrder: k })) };
        });
      },
      onSettled: refresh,
    }),
    remove: m((id: string) => api(`/event-types/${id}`, { method: "DELETE" })),
  };
}

// Tags for tasks and reminders (user request 2026-10-11). Changing or deleting one also refreshes the task and
// reminder lists that show it.
export const useTags = () => useQuery({ queryKey: ["tags"], queryFn: () => api<{ tags: Tag[] }>("/tags"), select: (d) => d.tags });
export function useTagActions() {
  const qc = useQueryClient();
  const refresh = (all = false) =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "tags" || q.queryKey[0] === "history" || (all && (q.queryKey[0] === "tasks" || q.queryKey[0] === "reports")) });
  return {
    create: useMutation({ mutationFn: (input: { name: string; color?: Tag["color"] }) => api<{ id: string; name: string; color: Tag["color"] }>("/tags", { method: "POST", body: input }), onSettled: () => refresh() }),
    save: useMutation({ mutationFn: ({ id, ...input }: { id: string; name?: string; color?: Tag["color"] }) => api(`/tags/${id}`, { method: "PATCH", body: input }), onSettled: () => refresh() }),
    remove: useMutation({ mutationFn: (id: string) => api(`/tags/${id}`, { method: "DELETE" }), onSettled: () => refresh(true) }),
    order: useMutation({ mutationFn: (ids: string[]) => api("/tags/order", { method: "POST", body: { ids } }), onSettled: () => refresh() }),
  };
}

// Saved website logins (user request 2026-10-11). The list never has passwords; revealPassword asks for one
// when the user taps Show or Copy. It is a plain request (not a query or mutation) so the password is never kept
// in the query cache, the browser's saved copy or the offline copy.
export const useLogins = (employeeId?: string) =>
  useQuery({ queryKey: ["logins", employeeId ?? "all"], queryFn: () => api<{ logins: SiteLogin[] }>(`/logins${employeeId ? `?employee=${employeeId}` : ""}`) });
export function useLoginActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "logins" || q.queryKey[0] === "history" });
  return {
    add: useMutation({ mutationFn: (input: SiteLoginInput) => api<{ id: string }>("/logins", { method: "POST", body: input }), onSettled: refresh }),
    save: useMutation({ mutationFn: ({ id, input }: { id: string; input: SiteLoginInput }) => api(`/logins/${id}`, { method: "PUT", body: input }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/logins/${id}`, { method: "DELETE" }), onSettled: refresh }),
  };
}
export const revealPassword = (id: string, copy: boolean) => api<{ password: string }>(`/logins/${id}/reveal`, { method: "POST", body: { copy } }).then((r) => r.password);

// Increment done (user request 2026-10-07): the date moves a year on; undoTo puts the old date back.
export function useIncrementDone() {
  const qc = useQueryClient();
  return useMutation({
    // basicPay: the new basic pay saved with the increment (user request 2026-10-08); restoreBasicPay (with undoTo):
    // the basic pay to put back on Undo.
    mutationFn: ({ id, undoTo, basicPay, restoreBasicPay }: { id: string; undoTo?: string; basicPay?: number | null; restoreBasicPay?: number | null }) =>
      api<{ previous: string | null; next: string | null; previousBasicPay: number | null; basicPay: number | null }>(`/staff/employees/${id}/increment`, {
        method: "POST",
        body: undoTo ? { undoTo, ...(restoreBasicPay !== undefined ? { restoreBasicPay } : {}) } : basicPay !== undefined ? { basicPay } : {},
      }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => ["staff", "summary", "history"].includes(q.queryKey[0] as string) }),
  });
}

// Contract ending (user request 2026-10-08): renew for the same period, or ended (left on the end date); either
// completes the employee's "Contract ends" task.
export function useContractAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, undoTo, undo }: { id: string; action: "renew" | "ended"; undoTo?: string; undo?: boolean }) =>
      api<{ previous?: string | null; next?: string | null; leftOn?: string | null }>(`/staff/employees/${id}/contract/${action}`, {
        method: "POST",
        body: action === "renew" ? (undoTo ? { undoTo } : {}) : undo ? { undo: true } : {},
      }),
    // They also complete (or, on Undo, reopen) the "Contract ends" task: refresh everything but labels.
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "labels" }),
  });
}

// Probation declared (user request 2026-10-08): records today on the employee and completes their Probation
// declaration task; undo (with the date it recorded) clears it and reopens the task.
export function useProbationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, undo, declaredOn }: { id: string; undo?: boolean; declaredOn?: string }) =>
      api<{ declaredOn: string | null }>(`/staff/employees/${id}/probation`, { method: "POST", body: undo ? { undo: true, declaredOn } : {} }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "labels" }),
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

// Settings › Queue (user request 2026-10-23): the background queue, checked again every 15 seconds while shown.
// Run now and Retry may sync Gmail or make tasks, so everything is refreshed after them.
export const useQueue = () => useQuery({ queryKey: ["queue"], queryFn: () => api<QueueInfo>("/queue"), refetchInterval: 15_000 });
export function useQueueActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  return {
    run: useMutation({ mutationFn: () => api<QueueRunReport>("/queue/run", { method: "POST" }), onSettled: refresh }),
    retry: useMutation({ mutationFn: (id: string) => api<QueueRunReport>(`/queue/${id}/retry`, { method: "POST" }), onSettled: refresh }),
    discard: useMutation({ mutationFn: (id: string) => api(`/queue/${id}/discard`, { method: "POST" }), onSettled: refresh }),
  };
}
// Settings › Queue › Calls log (user request 2026-10-23): every outgoing call per request or 10-minute run, newest
// first; `before` loads the next page.
export type CallLogFilter = { failedOnly: boolean; selfChecks: boolean };
export const callLogPath = (f: CallLogFilter, before?: string) =>
  `/queue/calls${qs({ failed: f.failedOnly && "1", self: f.selfChecks && "1", before })}`;
export const useCallLog = (f: CallLogFilter) =>
  useQuery({ queryKey: ["queue", "calls", f], queryFn: () => api<{ calls: CallLog[]; more: boolean }>(callLogPath(f)), refetchInterval: 15_000 });
