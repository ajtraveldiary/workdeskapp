// Folds long recipient lists in an email's HTML into one line (user request 2026-10-06), using <details>, so
// it opens and closes with a tap inside the email's sandboxed frame without any script. A "line" is the run
// of inline content between line breaks (<br>) or block elements; one with ADDRESS_LIST_MIN or more email
// addresses becomes <details class="wd-addr"><summary>To: A, B and 38 more</summary>…the original…</details>.
import { ADDRESS_LIST_MIN, countAddresses, summaryParts } from "../shared/addressLists";

const BLOCK = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DETAILS", "DIV", "DL", "FIELDSET", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);

export const ADDRESS_LIST_STYLE =
  // One line: the names shorten with "…", "and 38 more ▸" always shows.
  "details.wd-addr{margin:2px 0}details.wd-addr>summary{display:flex;cursor:pointer;color:#5f6b7a;list-style:none;white-space:nowrap;-webkit-user-select:none;user-select:none}" +
  "details.wd-addr .wd-names{min-width:0;overflow:hidden;text-overflow:ellipsis}details.wd-addr .wd-more{flex:none;padding-left:.3em}" +
  "details.wd-addr>summary::-webkit-details-marker{display:none}details.wd-addr>summary::after{content:'▸';padding-left:.35em;color:#1e6bff}" +
  "details.wd-addr[open]>summary::after{content:'▾'}details.wd-addr>.wd-addr-list{padding:4px 0 2px}";

export function collapseAddressLists(html: string): string {
  if (countAddresses(html) < ADDRESS_LIST_MIN) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  // Deepest elements first, so a list is folded where it sits and not again by its container.
  const elements: HTMLElement[] = [doc.body, ...doc.body.querySelectorAll<HTMLElement>("*")].reverse();
  for (const el of elements) {
    if (el.closest("details.wd-addr") || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    // Split the element's children into lines.
    const lines: ChildNode[][] = [[]];
    for (const node of [...el.childNodes]) {
      const tag = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement).tagName : "";
      if (tag === "BR" || BLOCK.has(tag)) lines.push([]);
      else lines.at(-1)!.push(node);
    }
    for (const line of lines) {
      if (!line.length) continue;
      if (line.some((n) => n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).querySelector?.("details.wd-addr, " + [...BLOCK].join(",")))) continue;
      const text = line.map((n) => n.textContent ?? "").join("");
      if (countAddresses(text) < ADDRESS_LIST_MIN) continue;
      const details = doc.createElement("details");
      details.className = "wd-addr";
      const summary = doc.createElement("summary");
      const parts = summaryParts(text);
      const names = doc.createElement("span");
      names.className = "wd-names";
      names.textContent = parts.names;
      const more = doc.createElement("span");
      more.className = "wd-more";
      more.textContent = parts.more;
      summary.appendChild(names);
      summary.appendChild(more);
      const list = doc.createElement("span");
      list.className = "wd-addr-list";
      el.insertBefore(details, line[0]!);
      for (const n of line) list.appendChild(n);
      details.appendChild(summary);
      details.appendChild(list);
      changed = true;
    }
  }
  return changed ? doc.body.innerHTML : html;
}

// Plain-text emails: the lines to fold, by index, with their short line.
export function plainAddressLines(text: string): Map<number, { names: string; more: string }> {
  const out = new Map<number, { names: string; more: string }>();
  text.split("\n").forEach((line, i) => {
    if (countAddresses(line) >= ADDRESS_LIST_MIN) out.set(i, summaryParts(line));
  });
  return out;
}
