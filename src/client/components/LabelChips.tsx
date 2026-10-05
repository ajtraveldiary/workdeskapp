import type { Label } from "../../shared/types";
import { useLabels } from "../api";
import { cx } from "./ui";

// Gmail labels on an email, in their Gmail colours. Nested labels ("Parent/Child") show their full path.
export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      title={label.name}
      style={label.backgroundColor ? { backgroundColor: label.backgroundColor, color: label.textColor ?? "#000" } : undefined}
      className={cx("inline-flex max-w-36 items-center truncate rounded px-1.5 py-px text-[11px] leading-4 font-medium", !label.backgroundColor && "bg-slate-200 text-slate-700", className)}
    >
      {label.name}
    </span>
  );
}

export function LabelChips({ ids, max = 3, className }: { ids: string[]; max?: number; className?: string }) {
  const labels = useLabels().data?.labels ?? [];
  const shown = ids.map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l);
  if (shown.length === 0) return null;
  return (
    <span className={cx("inline-flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.slice(0, max).map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {shown.length > max && <span className="text-[11px] text-slate-500">+{shown.length - max}</span>}
    </span>
  );
}
