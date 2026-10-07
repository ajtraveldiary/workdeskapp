import type { Thread } from "../../shared/types";
import { useLabels } from "../api";
import { formatWhen } from "../format";
import { TONE, cx, type Tone } from "./ui";

type Tag = { tone: Tone; label: string; title?: string };

// Up to two tags: what happened to the email's task (if it has one), and where the email itself stands.
// An email with no task shows only its state ("Needs decision", "Removed"). Snooze was removed (2026-10-06).
// The "dismissed" state is called "Removed" on screen (user request 2026-10-06).
export function emailTags(thread: Thread, sectionName?: string): Tag[] {
  const tags: Tag[] = [];
  const t = thread.task;
  if (t && t.open > 0) tags.push(t.overdue ? { tone: "urgent", label: "Task overdue" } : { tone: "medium", label: t.open > 1 ? `${t.open} tasks pending` : "Task pending" });
  else if (t && t.done > 0) tags.push({ tone: "low", label: "Task done" });

  if (thread.state === "needs_decision")
    tags.push(thread.muted ? { tone: "neutral", label: "Hidden from Pending", title: "Sender is hidden in Settings > Mail" } : { tone: "brand", label: "Needs decision" });
  else if (thread.state === "dismissed") tags.push({ tone: "neutral", label: "Removed", title: `Removed ${formatWhen(thread.stateChangedAt)}` });
  // Another section of the office has it (user request 2026-10-07).
  else if (thread.state === "elsewhere")
    tags.push({ tone: "info", label: `With ${sectionName ?? "another section"}`, title: "Its label is another section's, so it is taken as handled there. A new reply brings it back to Pending." });
  return tags;
}

const useSectionName = (thread: Thread) => {
  const labels = useLabels().data?.labels;
  return thread.sectionLabelId ? labels?.find((l) => l.id === thread.sectionLabelId)?.name : undefined;
};

// In Pending: the email came back after another section had it, because a new reply arrived (or it was
// restored) — the help text for it (user request 2026-10-07).
export function SectionBackTag({ thread }: { thread: Thread }) {
  const name = useSectionName(thread);
  if (thread.state !== "needs_decision" || !thread.sectionLabelId) return null;
  return (
    <span
      title={`${name ?? "Another section"} had this email (its label). It came back to Pending because a new reply arrived or it was restored.`}
      className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption2 font-medium whitespace-nowrap", TONE.snooze.soft)}
    >
      <span className={cx("size-1.5 rounded-full", TONE.snooze.dot)} aria-hidden />
      Back from {name ?? "another section"}
    </span>
  );
}

export function EmailStatusTags({ thread, className }: { thread: Thread; className?: string }) {
  const sectionName = useSectionName(thread);
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-1.5", className)}>
      {emailTags(thread, sectionName).map((tag) => (
        <span key={tag.label} title={tag.title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption2 font-medium whitespace-nowrap", TONE[tag.tone].soft)}>
          <span className={cx("size-1.5 rounded-full", TONE[tag.tone].dot)} aria-hidden />
          {tag.label}
        </span>
      ))}
    </span>
  );
}
