// The rule warnings for marking one person's days (warn only: nothing is blocked). Used by Person days (each mark
// button's short line) and the Mark leave pop-up (each warning in full with its rule), so both say the same thing
// (docs/ATTENDANCE_MARK_LEAVE_PLAN.md). Moved here from components/PersonDays.tsx on 2026-11-08; since then every
// warning that applies is listed (one used to replace another on the same button), and CH past the post's yearly
// limit is new.
import { CL_RUN_MAX, awayDay, chFits, clDays, go303Breaks, nextToLeave, notEligible, offsEarned, weeklyOff, type AttendanceMark, type MarkDay, type OffCheckDay, type WeeklyDay } from "./attendance";
import type { PersonDays } from "./types";

export type MarkKey = AttendanceMark | "clear";
// `short`: a few words for a button; `text`: the warning in full; `rule`: where the rule comes from.
export type MarkWarning = { short: string; text: string; rule: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What each mark would cause for the days chosen (`selected`, dates inside `data.days`). Days on leave, outside the
// office or holidays are not counted as chosen.
export function markWarnings(data: PersonDays, selected: Set<string>): Partial<Record<MarkKey, MarkWarning[]>> {
  const out: Partial<Record<MarkKey, MarkWarning[]>> = {};
  const add = (m: MarkKey, w: MarkWarning) => (out[m] ??= []).push(w);
  const chosen = data.days.filter((d) => selected.has(d.date) && !d.out && !d.leave);
  const working = chosen.filter((d) => !d.holiday);
  if (!working.length) return out;
  const w = data.weekly;
  const s = data.settings;
  // G.O.(Ms) 303/82/HSD: CL, CH and offs together for a week or more count nothing (as the server counts).
  const statesOf = (as?: AttendanceMark): WeeklyDay[] =>
    data.days.map((d) => {
      if (d.out || (w?.countFrom && d.date < w.countFrom)) return { date: d.date, state: "skip" as const };
      if (d.leave) return { date: d.date, state: "reset" as const };
      const m = as && selected.has(d.date) && !d.holiday ? as : d.mark;
      const state: WeeklyDay["state"] = m === "off" ? "off" : m === "absent" ? "reset" : m ? "count" : d.holiday ? "count" : s.assumeDuty && w?.countFrom && d.date < data.today ? "count" : "skip";
      return { date: d.date, state };
    });
  const states = (as?: AttendanceMark): WeeklyDay[] =>
    notEligible(
      statesOf(as),
      data.days.map((d) => {
        if (d.out || d.leave) return { date: d.date, mark: null };
        const m = as && selected.has(d.date) && !d.holiday ? as : d.mark;
        return { date: d.date, mark: m, holiday: !!d.holiday && !m };
      }),
    );
  if (w && data.employee.offDay === "weekly") {
    // An off before it is earned.
    const asked: OffCheckDay[] = states().map((x) => (working.some((d) => d.date === x.date) && data.days.find((d) => d.date === x.date)?.mark !== "off" ? { ...x, state: "off", asked: true, was: x.state } : x));
    const early = [...offsEarned(asked, { offsDue: w.dueBefore, towards: w.towardsBefore }, s).refused];
    if (early.length)
      add("off", {
        short: early.length === 1 ? `${plural(early[0]![1], "day")} early` : `${early.length} taken early`,
        text: early.length === 1 ? `The off is taken early: ${plural(early[0]![1], "more day")} of duty are needed to earn it.` : `${early.length} offs are taken before they are earned.`,
        rule: `One weekly off for every ${s.offEvery} days of duty (G.O.(Ms) 161/08/AD)`,
      });
    // Past the most days in a row.
    const before = new Set(weeklyOff(states(), undefined, s, w.runBefore).long);
    for (const m of ["present", "od", "cl", "cl_half"] as const) {
      const added = weeklyOff(states(m), undefined, s, w.runBefore).long.filter((x) => !before.has(x));
      if (added.length) add(m, { short: `past ${s.maxRun} days in a row`, text: `This makes more than ${s.maxRun} days in a row without an off.`, rule: `At most ${s.maxRun} days in a row without a weekly off` });
    }
  }
  // CL past the year's days (half days ½; days already CL don't count twice).
  for (const m of ["cl", "cl_half"] as const) {
    const more = working.reduce((n, d) => n + clDays(m) - clDays(d.mark), 0);
    if (data.cl + more > s.clPerYear) add(m, { short: `${data.cl + more} of ${s.clPerYear} CL`, text: `Casual leave this year would be ${data.cl + more} days, past the ${s.clPerYear} allowed.`, rule: `Casual leave: ${s.clPerYear} days a year (KSR Part I Appendix VII)` });
  }
  // CH past the post's limit for the year (G.O.(Ms) 43/2021/H&FWD).
  if (data.chLimit !== null) {
    const more = working.filter((d) => d.mark !== "ch").length;
    if (data.ch + more > data.chLimit)
      add("ch", { short: `${data.ch + more} of ${data.chLimit} CH`, text: `Compensation leave this year would be ${data.ch + more} days, past the ${data.chLimit} allowed for the post.`, rule: "CH a year by post (G.O.(Ms) 43/2021/H&FWD)" });
  }
  // CL / CH with the holidays around them past 15 days in a row (KSR Appendix VII).
  for (const m of ["cl", "ch"] as const) {
    let len = data.edges.before;
    let best = 0;
    let touches = false;
    for (const d of data.days) {
      const away = d.out || d.leave ? false : selected.has(d.date) && !d.holiday ? true : awayDay(d.mark, !!d.holiday);
      if (away) {
        len++;
        touches ||= selected.has(d.date);
        if (touches) best = Math.max(best, len);
      } else {
        len = 0;
        touches = false;
      }
    }
    if (touches && len > 0) best = Math.max(best, len + data.edges.after);
    if (best > CL_RUN_MAX) add(m, { short: `${best} days away in a row`, text: `With the holidays around them this makes ${best} days away in a row.`, rule: `CL and CH with holidays: at most ${CL_RUN_MAX} days at a stretch (KSR Part I Appendix VII)` });
  }
  // CH needs a holiday worked open for each day.
  const lacking = working.filter((d) => !data.chOpen.some((o) => chFits(o, d.date)));
  if (lacking.length)
    add("ch", {
      short: lacking.length === working.length ? "no holiday worked open" : `none open for ${lacking.length}`,
      text: lacking.length === working.length ? "No holiday worked is open for these days." : `No holiday worked is open for ${plural(lacking.length, "day")}.`,
      rule: "CH is for a holiday worked in the last 3 months (G.O.(Ms) 43/2021/H&FWD)",
    });
  // CL and CH not combined with regular leave (KSR Appendix VII rule 6; G.O.(Ms) 43/2021).
  const touching = nextToLeave(
    data.days.map((d) => ({ date: d.date, leave: !!d.leave, holiday: !!d.holiday && !d.mark })),
    new Set(working.map((d) => d.date)),
  );
  if (touching.length)
    for (const m of ["cl", "cl_half", "ch"] as const)
      add(m, { short: "next to leave", text: "These days touch regular leave from the Leave page.", rule: "CL and CH can't be joined to regular leave (KSR Part I Appendix VII rule 6; G.O.(Ms) 43/2021)" });
  // G.O.(Ms) 303/82/HSD: no off after a week away on CL, CH and offs; not CL, CH and an off all in one week.
  const marked: MarkDay[] = data.days.map((d) => ({ date: d.date, mark: d.out || d.leave ? null : d.mark, holiday: !d.out && !d.leave && !d.mark && !!d.holiday }));
  const dates = new Set(working.map((d) => d.date));
  for (const m of ["off", "cl", "cl_half", "ch"] as const) {
    if (m === "off" && data.employee.offDay !== "weekly") continue;
    const b = go303Breaks(marked, dates, m);
    if (b.offInLongAway.length) add(m, { short: "no off after a week away", text: "No weekly off is due inside a week or more away on CL, CH and offs.", rule: "G.O.(Ms) 303/82/HSD" });
    if (b.threeInWeek.length) add(m, { short: "CL, CH and off in one week", text: "CL, CH and an off would all fall in one week (Monday to Sunday).", rule: "G.O.(Ms) 303/82/HSD: CL with an off, or an off with CH, but not all three" });
  }
  return out;
}

// Holidays prefixed and suffixed to a leave (phase 2, for EL, HPL and commuted leave: KSR Part I): the unbroken run of
// the person's days off by themselves (holidays of the register, second Saturdays, Sundays for Sunday-off staff) just
// before `from` and just after `to`, not worked (no duty or OD marked). Days outside `data.days` aren't known.
export function prefixSuffix(data: PersonDays, from: string, to: string) {
  const at = new Map(data.days.map((d) => [d.date, d]));
  const off = (date: string) => {
    const d = at.get(date);
    return !!d && !!d.holiday && !d.out && !d.leave && d.mark !== "present" && d.mark !== "od";
  };
  const step = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const prefix: { date: string; name: string }[] = [];
  for (let d = step(from, -1); off(d); d = step(d, -1)) prefix.unshift({ date: d, name: at.get(d)!.holiday! });
  const suffix: { date: string; name: string }[] = [];
  for (let d = step(to, 1); off(d); d = step(d, 1)) suffix.push({ date: d, name: at.get(d)!.holiday! });
  return { prefix, suffix };
}

// The days `count` working days from `from` (the person's days off by themselves, leave and days out of the office
// skipped), or every working day from `from` to `to`. Days not in `data.days` aren't known, so fewer may come back.
export function workingDays(data: PersonDays, from: string, count: number | null, to: string | null) {
  const days = data.days.filter((d) => d.date >= from && (to === null || d.date <= to));
  const picked: string[] = [];
  const skipped: { date: string; why: string }[] = [];
  for (const d of days) {
    if (count !== null && picked.length >= count) break;
    if (d.out) skipped.push({ date: d.date, why: "not in the office" });
    else if (d.leave) skipped.push({ date: d.date, why: `on ${d.leave}` });
    else if (d.holiday) skipped.push({ date: d.date, why: d.holiday });
    else picked.push(d.date);
  }
  // Skipped days after the last one picked don't matter.
  const last = picked.at(-1);
  return { dates: picked, skipped: last ? skipped.filter((x) => x.date < last) : [] };
}
