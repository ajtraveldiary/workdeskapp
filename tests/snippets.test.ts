// Hidden text (Settings > Mail): saved snippets are found despite different spacing, line breaks and capitals.
import { describe, expect, it } from "vitest";
import { snippetRanges, stripSnippets } from "../src/shared/snippets";

const signature = `Regards,
District Medical Office (Health)
Thiruvananthapuram
Ph: 0471-2471291`;

describe("hidden text", () => {
  it("removes a signature whatever its spacing and capitals", () => {
    const email = "Sir,\n  Please find the following attachment.\n\nREGARDS,\nDistrict  Medical Office (Health)\r\nThiruvananthapuram\nPh:\t0471-2471291\n\n[Save a tree. Don't print unless it's really necessary!]";
    const r = stripSnippets(email, [signature, "[Save a tree. Don't print unless it's really necessary!]"]);
    expect(r).toEqual({ text: "Sir,\n  Please find the following attachment.", removed: 2 });
  });

  it("leaves text alone when the snippet isn't there, and ignores very short snippets", () => {
    expect(stripSnippets("Please reply today.", [signature, "ok"])).toEqual({ text: "Please reply today.", removed: 0 });
  });

  it("finds every occurrence, in Malayalam too", () => {
    const text = "ആദ്യം. ദയവായി പ്രിന്റ് ചെയ്യരുത്. രണ്ടാം. ദയവായി  പ്രിന്റ്\nചെയ്യരുത്.";
    expect(snippetRanges(text, ["ദയവായി പ്രിന്റ് ചെയ്യരുത്."])).toHaveLength(2);
  });

  it("matches Gmail's plain-text copy, with its *bold* marks and joined lines", () => {
    const saved = "Regards,\nDistrict Medical Office (Health)\nThiruvananthapuram\nPh: 0471-2471291\nFax: 04712473257\nemail: dmohealthtvm@gmail.com";
    const plain = "Sir,\nPlease find the following attachment.\n\n*Regards,District Medical\nOffice (Health)ThiruvananthapuramPh:     0471-2471291Fax:\n04712473257email:*dmohealthtvm@gmail.com\n**";
    expect(stripSnippets(plain, [saved]).text).toBe("Sir,\nPlease find the following attachment.");
  });
});
