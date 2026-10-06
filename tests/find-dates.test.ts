import { describe, expect, it } from "vitest";
import { findDueDate } from "../src/shared/findDates";

const today = "2026-10-06";

describe("due date found in an email", () => {
  it("reads Indian day-first dates in the usual styles", () => {
    expect(findDueDate("Submit the report on or before 15/10/2026.", today)).toBe("2026-10-15");
    expect(findDueDate("Meeting on 09.11.2026 at 10 am", today)).toBe("2026-11-09");
    expect(findDueDate("Last date 7-10-26", today)).toBe("2026-10-07");
    expect(findDueDate("Due 2026-12-01", today)).toBe("2026-12-01");
    expect(findDueDate("Marathon on 24th October 2026", today)).toBe("2026-10-24");
    expect(findDueDate("by 20 Nov", today)).toBe("2026-11-20");
    expect(findDueDate("on Sept 30, 2027", today)).toBe("2027-09-30");
    expect(findDueDate("Conference on October 8th", today)).toBe("2026-10-08");
    expect(findDueDate("before the 12th of December", today)).toBe("2026-12-12");
  });

  it("uses the earliest date still to come, skipping letter dates and references", () => {
    const body = "Ref: letter No. B2-1234/2026/DMO dated 01/09/2026.\nSubmit the data by 20/10/2026. Review meeting on 10/10/2026.";
    expect(findDueDate(body, today)).toBe("2026-10-10");
    expect(findDueDate("Today's date 06/10/2026", today)).toBe("2026-10-06");
  });

  it("finds nothing in emails without a usable date", () => {
    expect(findDueDate("Sir, Please find the attachment. Ph: 0471-2471291 Fax: 04712473257", today)).toBeNull();
    expect(findDueDate("Letter dated 15 September", today)).toBeNull(); // already past this year
    expect(findDueDate("31/02/2027 or 2026-13-01", today)).toBeNull(); // not real dates
    expect(findDueDate("Version 1.2.3 and 10.5.2", today)).toBeNull();
    expect(findDueDate("Plan for 01/01/2035", today)).toBeNull(); // too far ahead
  });
});
