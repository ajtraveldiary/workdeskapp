import { describe, expect, it } from "vitest";
import { normalizeSenderPattern } from "../src/shared/schemas";

describe("normalizeSenderPattern", () => {
  it("accepts addresses in the forms people paste them", () => {
    expect(normalizeSenderPattern("News@Example.GOV")).toBe("news@example.gov");
    expect(normalizeSenderPattern("  State Health Society <news@example.gov> ")).toBe("news@example.gov");
    expect(normalizeSenderPattern("mailto:news@example.gov")).toBe("news@example.gov");
  });

  it("turns a domain into a whole-domain entry", () => {
    expect(normalizeSenderPattern("@example.gov")).toBe("@example.gov");
    expect(normalizeSenderPattern("example.gov")).toBe("@example.gov");
  });

  it("rejects anything else", () => {
    for (const bad of ["", "news", "news@", "@gov", "two words@example.gov", "a@b"]) expect(normalizeSenderPattern(bad)).toBeNull();
  });
});
