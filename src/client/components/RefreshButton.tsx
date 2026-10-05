import { useState } from "react";
import { useIsFetching, useQueryClient, type Query, type QueryKey } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useMe, useSync } from "../api";
import { formatWhen } from "../format";
import { cx } from "./ui";

// Manual refresh for a screen or list: reloads it from the database, skipping the browser's saved copy.
// With `sync`, it first checks Gmail for new mail (cheap: only messages never seen before are downloaded).
export function RefreshButton({ keys, sync, label = "Refresh" }: { keys: QueryKey[]; sync?: boolean; label?: string }) {
  const qc = useQueryClient();
  const gmail = useSync();
  const demo = useMe().data?.demo;
  const [busy, setBusy] = useState(false);
  const matches = (q: Query) => keys.some((k) => k.every((part, i) => q.queryKey[i] === part));
  const fetching = useIsFetching({ predicate: matches }) > 0;
  const updatedAt = Math.max(0, ...qc.getQueryCache().findAll({ predicate: matches }).map((q) => q.state.dataUpdatedAt));

  const refresh = async () => {
    setBusy(true);
    try {
      // (In demo mode "sync" would simulate a new email, so it is skipped here.)
      if (sync && !demo) await gmail.mutateAsync().catch(() => undefined); // a Gmail problem shouldn't block reloading the list
      await fetch("/api/maintain", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      await Promise.all(keys.map((queryKey) => qc.refetchQueries({ queryKey })));
    } finally {
      setBusy(false);
    }
  };

  const spinning = busy || fetching;
  const title = `${label}${updatedAt ? ` · updated ${formatWhen(new Date(updatedAt).toISOString())}` : ""}`;
  return (
    <button
      onClick={refresh}
      disabled={busy}
      title={title}
      aria-label={title}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-slate-600 hover:border-slate-300 hover:text-ink disabled:opacity-70 pointer-coarse:size-9"
    >
      <RefreshCw size={16} className={cx(spinning && "animate-spin text-brand-600")} />
    </button>
  );
}
