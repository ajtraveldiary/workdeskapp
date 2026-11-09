// Offs log (user request 2026-11-10, "a button to view a log of all offs, C-offs, holiday / SS for weekly-off staff, with
// a filter for staff and type of off"): every off and holiday taken (H / SS) of weekly-off staff, oldest first. A C-off
// (user's answer: "the second off owed") is the off that pays back the compensatory off: an off earned while another
// was still owed (12 days without an off owe an off + a compensatory off); offs pay the oldest owed first.
import type { WeeklyDay } from "./attendance";

export type OffKind = "off" | "coff" | "h" | "ss";
export const OFF_KINDS: { kind: OffKind; label: string; name: string }[] = [
  { kind: "off", label: "Off", name: "Weekly off" },
  { kind: "coff", label: "C-off", name: "Compensatory off" },
  { kind: "h", label: "H", name: "Holiday taken" },
  { kind: "ss", label: "SS", name: "Second Saturday taken" },
];
export type OffsLogEntry = { employeeId: string; date: string; kind: OffKind; details: string };
export type OffsLogPerson = { id: string; name: string; designation: string | null; left: boolean };
export type OffsLog = { from: string; to: string; entries: OffsLogEntry[]; people: OffsLogPerson[] };

// Each off taken in `days` (as weeklyOff counts them, corrections as `set`): "off", "coff" (it pays an off earned while
// another was owed), or "early" (taken before one was earned). Starting figures with offs owed count the first as an
// off and the rest as compensatory.
export function offKinds(days: WeeklyDay[], start?: { offsDue: number; towards: number }, figures?: { offEvery?: number }) {
  const every = figures?.offEvery ?? 6;
  let counted = start?.towards ?? 0;
  let due = start?.offsDue ?? 0;
  const owedAs = (n: number): ("off" | "coff")[] => Array.from({ length: Math.max(0, n) }, (_, i) => (i === 0 ? "off" : "coff"));
  let owed = owedAs(due);
  const out = new Map<string, "off" | "coff" | "early">();
  for (const d of days) {
    if (d.state === "count") {
      counted++;
      if (counted % every === 0) {
        due++;
        // Earned while another off is still owed: the compensatory one.
        if (due > 0) owed.push(due >= 2 ? "coff" : "off");
      }
    } else if (d.state === "off") {
      out.set(d.date, owed.shift() ?? "early");
      due--;
    }
    if (d.set) {
      ({ offsDue: due, towards: counted } = d.set);
      owed = owedAs(due);
    }
  }
  return out;
}
