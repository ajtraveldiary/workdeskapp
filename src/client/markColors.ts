// One colour per kind of attendance mark, used everywhere a mark is shown: the register, Person days and the Mark
// leave pop-up's chips (user request 2026-11-08, docs/ATTENDANCE_MARK_LEAVE_PLAN.md phase 3: "the register cleaned
// up"). ✓ plain, O blue, CL and ½CL amber, CH purple, OD teal, H / SS grey, A red; leave from the Leave page is a
// grey band (LEAVE_BAND). Fixed teal colours carry their own dark-mode variant.
import type { AttendanceMark } from "../shared/attendance";

export const MARK_COLOR: Record<AttendanceMark, string> = {
  present: "font-semibold text-ink",
  off: "font-semibold text-info-ink",
  cl: "font-semibold text-medium-ink",
  cl_half: "font-semibold text-medium-ink",
  ch: "font-semibold text-snooze-ink",
  od: "font-semibold text-[#0f6660] dark:text-[#9fe0d8]",
  holiday: "font-medium text-slate-500",
  absent: "font-bold text-urgent-ink",
};
export const LEAVE_BAND = "bg-slate-200 text-slate-700";

// The key to the marks, in the order the Key lists them.
export const MARK_KEY: { mark: AttendanceMark; symbol: string; name: string }[] = [
  { mark: "present", symbol: "✓", name: "Present" },
  { mark: "od", symbol: "OD", name: "On duty elsewhere (counts as present)" },
  { mark: "off", symbol: "O", name: "Weekly off" },
  { mark: "cl", symbol: "CL", name: "Casual leave" },
  { mark: "cl_half", symbol: "½CL", name: "Half day casual leave" },
  { mark: "ch", symbol: "CH", name: "Compensation leave" },
  { mark: "holiday", symbol: "H / SS", name: "Holiday / second Saturday taken" },
  { mark: "absent", symbol: "A", name: "Absent" },
];
