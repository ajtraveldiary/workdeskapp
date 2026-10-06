// Long recipient lists in an email (a forwarded email's "To: a <x>, b <y>, …" with dozens of addresses) are
// folded into one short line in the reader (user request 2026-10-06): "To: Karakulam PHC, edava phc and 38
// more". This part finds the addresses and writes the short line; the reader does the folding.

export const ADDRESS_LIST_MIN = 4; // a line with this many addresses or more is folded

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;

export function countAddresses(text: string) {
  return text.match(EMAIL)?.length ?? 0;
}

// "To: Name One <one@x.in>, two@y.com, Name Three <three@z.org>" → { label: "To", names: ["Name One", "two@y.com", …] }
export function addressSummary(line: string): { label: string | null; names: string[] } {
  let text = line.replace(/\s+/g, " ").trim();
  const head = /^\s*([A-Za-z][A-Za-z ]{0,12}):\s*/.exec(text);
  const label = head && !head[1]!.includes("@") ? head[1]!.trim() : null;
  if (head && label) text = text.slice(head[0].length);
  const names: string[] = [];
  const seen = new Set<string>();
  // Each recipient is "Name <address>" or a bare address, separated by commas or semicolons.
  for (const part of text.split(/[,;](?![^<]*>)/)) {
    const address = part.match(EMAIL)?.[0];
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    const name = part
      .replace(/<[^>]*>/g, "")
      .replace(EMAIL, "")
      .replace(/["'<>()[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    names.push(name || address);
  }
  return { label, names };
}

// The short line in two parts, so the names can be cut short on a narrow screen while "and 38 more" stays:
// { names: "To: Karakulam PHC, edava phc", more: " and 38 more" }.
export function summaryParts(line: string, shown = 2) {
  const { label, names } = addressSummary(line);
  const rest = names.length - Math.min(shown, names.length);
  return { names: `${label ? `${label}: ` : ""}${names.slice(0, shown).join(", ")}`, more: rest > 0 ? ` and ${rest} more` : "" };
}

export function summaryText(line: string, shown = 2) {
  const p = summaryParts(line, shown);
  return p.names + p.more;
}
