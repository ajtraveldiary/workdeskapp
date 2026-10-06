import { describe, expect, it } from "vitest";
import { emailTags } from "../src/client/components/EmailStatus";
import type { Thread } from "../src/shared/types";

const base: Thread = {
  id: "t",
  gmailThreadId: "g",
  accountEmail: null,
  subject: "s",
  fromName: null,
  fromEmail: null,
  snippet: "",
  lastMessageAt: "2026-10-05T00:00:00Z",
  messageCount: 1,
  unread: false,
  state: "task",
  snoozedUntil: null,
  hasNewActivity: false,
  stateChangedAt: "2026-10-05T00:00:00Z",
  task: null,
  muted: false,
  labelIds: [],
};
const labels = (t: Partial<Thread>) => emailTags({ ...base, ...t }).map((x) => `${x.tone}:${x.label}`);

describe("emailTags", () => {
  it("marks open, overdue and finished tasks", () => {
    expect(labels({ task: { open: 1, done: 0, overdue: false } })).toEqual(["medium:Task pending"]);
    expect(labels({ task: { open: 1, done: 2, overdue: true } })).toEqual(["urgent:Task overdue"]);
    expect(labels({ task: { open: 0, done: 1, overdue: false } })).toEqual(["low:Task done"]);
  });

  it("shows only the email's state when it has no task", () => {
    expect(labels({ state: "needs_decision" })).toEqual(["brand:Needs decision"]);
    expect(labels({ state: "snoozed" })).toEqual(["snooze:Snoozed"]);
    expect(labels({ state: "dismissed" })).toEqual(["neutral:Dismissed"]);
  });

  it("marks pending emails from hidden senders", () => {
    expect(labels({ state: "needs_decision", muted: true })).toEqual(["neutral:Hidden from Pending"]);
  });

  it("shows both when a finished task's email got a new reply", () => {
    expect(labels({ state: "needs_decision", task: { open: 0, done: 1, overdue: false } })).toEqual(["low:Task done", "brand:Needs decision"]);
  });
});
