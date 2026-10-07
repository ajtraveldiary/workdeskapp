import type { EmailState } from "../db/schema";

type Existing = { state: EmailState; lastMessageAt: Date; hasNewActivity: boolean };

export type ThreadDecision = {
  state: EmailState;
  hasNewActivity: boolean;
  // Set when the change should be written to the audit trail.
  event?: { action: string; summary: string };
};

// What happens to a conversation's dashboard state when Gmail reports it changed.
// The guiding rule: a new message must never slip past unnoticed.
export function onThreadUpdate(
  existing: Existing | undefined,
  newLastMessageAt: Date,
  openTaskCount: number,
): ThreadDecision {
  if (!existing) return { state: "needs_decision", hasNewActivity: false };

  const keep = { state: existing.state, hasNewActivity: existing.hasNewActivity };
  if (newLastMessageAt.getTime() <= existing.lastMessageAt.getTime()) return keep;

  switch (existing.state) {
    case "needs_decision":
      return keep;
    // Handled by another section, but a new reply came: back to Pending (user request 2026-10-07).
    case "elsewhere":
      return {
        state: "needs_decision",
        hasNewActivity: false,
        event: { action: "email.returned", summary: "New reply after another section had it; back to Pending" },
      };
    case "dismissed":
    case "snoozed":
      return {
        state: "needs_decision",
        hasNewActivity: false,
        event: { action: "email.returned", summary: `New message arrived; returned to queue (was ${existing.state})` },
      };
    case "task":
      if (openTaskCount > 0) {
        return {
          state: "task",
          hasNewActivity: true,
          event: { action: "email.new_activity", summary: "New message on a conversation with an open task" },
        };
      }
      return {
        state: "needs_decision",
        hasNewActivity: false,
        event: { action: "email.returned", summary: "New message after its task was completed; returned to queue" },
      };
  }
}
