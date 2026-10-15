// Joining and relieving an employee (user request 2026-10-15): each is a task "For" the employee whose steps are
// the paperwork, and the Employees page's "Joining & relieving" table shows every step's state. The table and the
// task's steps are the same data (the task's checklist, matched by these step ids), so a change in either shows in
// both; the task completes itself once every step is done.
import type { ChecklistItem } from "./types";

export const MOVE_KINDS = ["join", "relieve"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

// Pending / Waiting / Done, as in the user's spreadsheet (Received is Done for steps that are papers coming in).
export const STEP_STATES = ["pending", "waiting", "done"] as const;
export type StepState = (typeof STEP_STATES)[number];

export type MoveStep = { id: string; text: string; short: string; doneLabel: "Done" | "Received" };

// The user's own steps and order (2026-10-15).
export const MOVE_STEPS: Record<MoveKind, MoveStep[]> = {
  join: [
    { id: "joining-report", text: "Joining report", short: "Joining report", doneLabel: "Received" },
    { id: "spark-add", text: "Adding in SPARK", short: "Add SPARK", doneLabel: "Done" },
    { id: "letter-sent", text: "Send letter to institution", short: "Letter to institution", doneLabel: "Done" },
    { id: "sb-received", text: "Service book received", short: "SB received", doneLabel: "Received" },
  ],
  relieve: [
    { id: "relieving-order", text: "Relieving order", short: "Relieving order", doneLabel: "Done" },
    { id: "spark-relieve", text: "Relieve in SPARK", short: "SPARK relieve", doneLabel: "Done" },
    { id: "letter-received", text: "Letter from institution", short: "Letter from institution", doneLabel: "Received" },
    { id: "sb-update", text: "Update service book", short: "SB update", doneLabel: "Done" },
    { id: "lpc-sent", text: "Send LPC / service book", short: "LPC / SB sent", doneLabel: "Done" },
  ],
};

export const MOVE_LABEL: Record<MoveKind, string> = { join: "Joining", relieve: "Relieving" };
export const moveTitle = (kind: MoveKind, name: string) => `${MOVE_LABEL[kind]}: ${name}`;
// The task is due this many days after the joining / relieving date.
export const MOVE_DUE_DAYS = 7;

// A step's state from its checklist item; null when the step was taken out of the task.
export const stepState = (item: ChecklistItem | undefined): StepState | null => (!item ? null : item.done ? "done" : item.waiting ? "waiting" : "pending");
// The checklist item for a state.
export const withState = (item: ChecklistItem, state: StepState): ChecklistItem => ({ ...item, done: state === "done", waiting: state === "waiting" });
export const moveChecklist = (kind: MoveKind): ChecklistItem[] => MOVE_STEPS[kind].map((s) => ({ id: s.id, text: s.text, done: false }));
