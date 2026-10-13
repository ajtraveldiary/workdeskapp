import type { Thread } from "../../shared/types";
import { useLabels, useMe } from "../api";
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
  // Back in Pending after its task was done: DoneBeforeTag says so, with the date (user request 2026-10-13).
  else if (t && t.done > 0 && !(thread.state === "needs_decision" && t.doneAt)) tags.push({ tone: "low", label: "Task done" });

  if (thread.state === "needs_decision")
    tags.push(thread.muted ? { tone: "neutral", label: "Hidden from Pending", title: "Sender is hidden in Settings > Mail" } : { tone: "brand", label: "Needs decision" });
  else if (thread.state === "dismissed") tags.push({ tone: "neutral", label: "Removed", title: `Removed ${formatWhen(thread.stateChangedAt)}` });
  // Made into an event (user request 2026-10-11).
  else if (thread.state === "event") tags.push({ tone: "info", label: "Event", title: "Made into an event (Events page). A new reply brings it back to Pending." });
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

// In Pending again although its task was completed: a new message came in the conversation after that (user request
// 2026-10-13, "show in pending mail with note already done on <date>"). Shown on email rows and in the viewer.
export function DoneBeforeTag({ thread }: { thread: Thread }) {
  const tz = useMe().data?.timezone;
  const t = thread.task;
  if (thread.state !== "needs_decision" || !t || t.open > 0 || !t.done || !t.doneAt) return null;
  const at = new Date(t.doneAt);
  const sameYear = at.getFullYear() === new Date().getFullYear();
  const day = at.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), ...(tz ? { timeZone: tz } : {}) });
  return (
    <span
      title={`Its task was completed on ${formatWhen(t.doneAt)}. A new message came in the conversation after that, so it is back in Pending.`}
      className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption2 font-medium whitespace-nowrap", TONE.low.soft)}
    >
      <span className={cx("size-1.5 rounded-full", TONE.low.dot)} aria-hidden />
      Already done on {day}
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
