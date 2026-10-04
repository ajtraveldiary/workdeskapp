import { describe, expect, it } from "vitest";
import { onThreadUpdate } from "../src/server/lib/threadRules";
import { snapshotFromGmail } from "../src/server/lib/sync";
import { parseFrom } from "../src/server/lib/gmail";

const t0 = new Date("2026-10-01T10:00:00Z");
const later = new Date("2026-10-02T10:00:00Z");
const existing = (state: "needs_decision" | "task" | "snoozed" | "dismissed") => ({ state, lastMessageAt: t0, hasNewActivity: false });

describe("onThreadUpdate", () => {
  it("puts new conversations in the queue", () => {
    expect(onThreadUpdate(undefined, t0, 0).state).toBe("needs_decision");
  });

  it("leaves decisions alone when nothing new arrived (e.g. only read status changed)", () => {
    for (const s of ["dismissed", "snoozed", "task"] as const) {
      expect(onThreadUpdate(existing(s), t0, 1)).toEqual({ state: s, hasNewActivity: false });
    }
  });

  it("returns a dismissed or snoozed conversation to the queue when a new message arrives", () => {
    for (const s of ["dismissed", "snoozed"] as const) {
      const d = onThreadUpdate(existing(s), later, 0);
      expect(d.state).toBe("needs_decision");
      expect(d.event?.action).toBe("email.returned");
    }
  });

  it("flags new activity on a conversation whose task is still open", () => {
    const d = onThreadUpdate(existing("task"), later, 1);
    expect(d).toMatchObject({ state: "task", hasNewActivity: true });
  });

  it("returns a conversation to the queue if its tasks are all completed", () => {
    expect(onThreadUpdate(existing("task"), later, 0).state).toBe("needs_decision");
  });
});

describe("snapshotFromGmail", () => {
  const msg = (id: string, date: number, labels: string[], from: string, subject = "Re: Statement") => ({
    id,
    threadId: "t1",
    internalDate: String(date),
    labelIds: labels,
    snippet: "Please submit &amp; confirm",
    payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
  });

  it("uses the first subject, latest inbox sender, and any-unread", () => {
    const s = snapshotFromGmail("t1", [
      msg("2", 2000, ["SENT"], "Me <me@example.com>"),
      msg("1", 1000, ["INBOX"], '"District Office" <do@example.gov>', "Statement"),
      msg("3", 3000, ["INBOX", "UNREAD"], "Accounts <acc@example.gov>"),
    ])!;
    expect(s.subject).toBe("Statement");
    expect(s.fromName).toBe("Accounts");
    expect(s.unread).toBe(true);
    expect(s.messageCount).toBe(3);
    expect(s.lastMessageAt.getTime()).toBe(3000);
    expect(s.snippet).toBe("Please submit & confirm");
  });

  it("parses bare sender addresses", () => {
    expect(parseFrom("clerk@example.gov")).toEqual({ name: null, email: "clerk@example.gov" });
  });
});
