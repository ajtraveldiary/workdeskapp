import type { Thread } from "../../shared/types";
import { formatWhen } from "../format";
import { TONE, cx, type Tone } from "./ui";

type Tag = { tone: Tone; label: string; title?: string };

// Up to two tags: what happened to the email's task (if it has one), and where the email itself stands.
// An email with no task shows only its state ("Needs decision", "Removed"). Snooze was removed (2026-10-06).
// The "dismissed" state is called "Removed" on screen (user request 2026-10-06).
export function emailTags(thread: Thread): Tag[] {
  const tags: Tag[] = [];
  const t = thread.task;
  if (t && t.open > 0) tags.push(t.overdue ? { tone: "urgent", label: "Task overdue" } : { tone: "medium", label: t.open > 1 ? `${t.open} tasks pending` : "Task pending" });
  else if (t && t.done > 0) tags.push({ tone: "low", label: "Task done" });

  if (thread.state === "needs_decision")
    tags.push(thread.muted ? { tone: "neutral", label: "Hidden from Pending", title: "Sender is hidden in Settings > Mail" } : { tone: "brand", label: "Needs decision" });
  else if (thread.state === "dismissed") tags.push({ tone: "neutral", label: "Removed", title: `Removed ${formatWhen(thread.stateChangedAt)}` });
  return tags;
}

export function EmailStatusTags({ thread, className }: { thread: Thread; className?: string }) {
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-1.5", className)}>
      {emailTags(thread).map((tag) => (
        <span key={tag.label} title={tag.title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption2 font-medium whitespace-nowrap", TONE[tag.tone].soft)}>
          <span className={cx("size-1.5 rounded-full", TONE[tag.tone].dot)} aria-hidden />
          {tag.label}
        </span>
      ))}
    </span>
  );
}
