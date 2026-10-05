import { describe, expect, it } from "vitest";
import { defaultFirstPeriod, periodAt, periodsFrom, monthIndex, ruleText, shortLabel, type ScheduleRule } from "../src/shared/reportSchedule";

const monthly: ScheduleRule = { frequency: "monthly", dueDay: 5, dueMonthOffset: 1, yearStartMonth: 4 };
const quarterlyFY: ScheduleRule = { frequency: "quarterly", dueDay: 15, dueMonthOffset: 1, yearStartMonth: 4 };
const annualFY: ScheduleRule = { frequency: "annual", dueDay: 30, dueMonthOffset: 3, yearStartMonth: 4 };

describe("report schedule", () => {
  it("monthly: September's statement is due on 5 October", () => {
    expect(periodAt(monthly, monthIndex("2026-09-01"))).toEqual({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      dueDate: "2026-10-05",
      label: "Sep 2026",
    });
  });

  it("quarterly on the financial year: Jul-Sep is Q2, due 15 October", () => {
    const aligned = periodsFrom(quarterlyFY, "2026-08-20", () => true, 1)[0]!;
    expect(aligned).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-09-30", dueDate: "2026-10-15", label: "Q2 FY 2026-27" });
    expect(shortLabel(quarterlyFY, monthIndex("2026-07-01"))).toBe("Q2");
  });

  it("annual financial year: FY 2025-26 report due 30 June 2026", () => {
    const p = periodsFrom(annualFY, "2025-06-01", () => true, 1)[0]!;
    expect(p).toMatchObject({ periodStart: "2025-04-01", periodEnd: "2026-03-31", dueDate: "2026-06-30", label: "FY 2025-26" });
  });

  it("calendar-year quarters and labels", () => {
    const rule: ScheduleRule = { frequency: "quarterly", dueDay: 10, dueMonthOffset: 0, yearStartMonth: 1 };
    expect(periodsFrom(rule, "2026-11-15", () => true, 1)[0]).toMatchObject({ periodStart: "2026-10-01", dueDate: "2026-12-10", label: "Q4 2026" });
  });

  it("clamps the due day to short months", () => {
    const rule: ScheduleRule = { frequency: "monthly", dueDay: 31, dueMonthOffset: 0, yearStartMonth: 4 };
    expect(periodAt(rule, monthIndex("2026-02-01")).dueDate).toBe("2026-02-28");
    expect(periodAt(rule, monthIndex("2028-02-01")).dueDate).toBe("2028-02-29");
  });

  it("starts tracking from the earliest period not yet due", () => {
    expect(defaultFirstPeriod(monthly, "2026-10-05")).toBe("2026-09-01"); // Sep report due today
    expect(defaultFirstPeriod(monthly, "2026-10-06")).toBe("2026-10-01");
    expect(defaultFirstPeriod(annualFY, "2026-10-05")).toBe("2026-04-01"); // FY 2026-27, due June 2027
  });

  it("generates consecutive periods until told to stop", () => {
    const ps = periodsFrom(monthly, "2026-08-01", (p) => p.dueDate <= "2026-11-30");
    expect(ps.map((p) => p.label)).toEqual(["Aug 2026", "Sep 2026", "Oct 2026"]);
  });

  it("describes the rule in words", () => {
    expect(ruleText(monthly)).toBe("Due on the 5th of the following month");
    expect(ruleText(annualFY)).toBe("Due on the 30th of the 3rd month after the period ends (year starts in April)");
  });
});
