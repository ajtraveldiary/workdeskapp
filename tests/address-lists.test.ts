import { describe, expect, it } from "vitest";
import { addressSummary, countAddresses, summaryText } from "../src/shared/addressLists";

const to =
  "To: Medical Officer Karakulam PHC <karakulamphc@gmail.com>, cherunniyoor phc <crnyrphc@gmail.com>, Phc Chemmaruthy <cmyphc@gmail.com>, edava phc <edavaphc@gmail.com>, <anakudyphc@gmail.com>, phcbharathannoor@ymail.com <phcbharathannoor@gmail.com>";

describe("long recipient lists in emails", () => {
  it("counts and names the recipients", () => {
    expect(countAddresses(to)).toBe(7);
    const s = addressSummary(to);
    expect(s.label).toBe("To");
    expect(s.names.slice(0, 4)).toEqual(["Medical Officer Karakulam PHC", "cherunniyoor phc", "Phc Chemmaruthy", "edava phc"]);
    expect(s.names).toContain("anakudyphc@gmail.com"); // no name: the address stands in
    expect(s.names).toHaveLength(6);
  });

  it("writes the short line", () => {
    expect(summaryText(to)).toBe("To: Medical Officer Karakulam PHC, cherunniyoor phc and 4 more");
    expect(summaryText("Cc: a@x.in; b@x.in; c@x.in; d@x.in")).toBe("Cc: a@x.in, b@x.in and 2 more");
    expect(summaryText("a@x.in, b@x.in, c@x.in, d@x.in")).toBe("a@x.in, b@x.in and 2 more");
  });
});
