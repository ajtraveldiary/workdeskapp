// When each step of a task's checklist last changed (user request 2026-10-31: a leave shows the step of its task
// that was updated last). The server stamps `at` on a step whose done / waiting state changes (or that is added
// already done or waiting); unchanged steps keep their time. Whatever `at` the app sends is ignored.
import type { ChecklistItem } from "../../shared/types";

export function stampChecklist(before: ChecklistItem[], after: ChecklistItem[], now = new Date().toISOString()): ChecklistItem[] {
  const prev = new Map(before.map((i) => [i.id, i]));
  return after.map(({ at: _sent, ...item }) => {
    const was = prev.get(item.id);
    const changed = was ? was.done !== item.done || !!was.waiting !== !!item.waiting : item.done || !!item.waiting;
    const at = changed ? now : was?.at;
    return at ? { ...item, at } : item;
  });
}
