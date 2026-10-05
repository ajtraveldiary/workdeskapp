import { useState } from "react";
import { CheckCircle2, CircleDot, Mail, RotateCcw } from "lucide-react";
import type { AuditEvent } from "../../shared/types";
import { useHistory, useRestore } from "../api";
import { formatDateTime } from "../format";
import { Button, Card, Empty, PageHeader, SearchInput, Tabs } from "../components/ui";
import { RefreshButton } from "../components/RefreshButton";

type Filter = "" | "email" | "task";

export function HistoryPage() {
  const [type, setType] = useState<Filter>("");
  const [q, setQ] = useState("");
  const { data, error } = useHistory({ type, q });
  const restore = useRestore();

  return (
    <>
      <PageHeader title="History" subtitle="A record of every decision: tasks created, completed and reopened; emails dismissed, snoozed and restored." actions={<RefreshButton keys={[["history"]]} label="Refresh history" />} />
      <Tabs<Filter>
        value={type}
        onChange={setType}
        options={[
          { value: "", label: "Everything" },
          { value: "email", label: "Emails" },
          { value: "task", label: "Tasks" },
        ]}
      />
      <div className="mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search history…" />
      </div>
      {error && <p className="text-urgent-ink">{error.message}</p>}
      <Card>
        {!data || data.events.length === 0 ? (
          <Empty title="Nothing recorded yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                <EventIcon e={e} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{e.detail?.title ?? e.detail?.subject ?? "—"}</p>
                  <p className="text-sm text-slate-600">
                    {e.summary}
                    <span className="text-slate-400"> · {formatDateTime(e.createdAt)}</span>
                  </p>
                </div>
                {e.action === "email.dismissed" && e.emailState === "dismissed" && e.entityId && (
                  <Button size="sm" onClick={() => restore.mutate(e.entityId!)} disabled={restore.isPending}>
                    <RotateCcw size={14} /> Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function EventIcon({ e }: { e: AuditEvent }) {
  const cls = "mt-0.5 shrink-0";
  if (e.action === "task.completed") return <CheckCircle2 size={18} className={`${cls} text-brand-600`} />;
  if (e.entityType === "email") return <Mail size={18} className={`${cls} text-slate-400`} />;
  return <CircleDot size={18} className={`${cls} text-slate-400`} />;
}
