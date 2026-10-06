// Hidden text in HTML emails: the same whitespace- and case-insensitive matching as src/shared/snippets.ts,
// run across the email's text nodes, so a signature split over <br>s, <p>s and <b>s is still found.
import { snippetRanges } from "../shared/snippets";

export function stripSnippetsFromHtml(html: string, snippets: string[]): { html: string; removed: number } {
  if (snippets.length === 0) return { html, removed: 0 };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  // The email's text in order, remembering which text node each character came from; <br>s are noted by
  // the position they sit at so the line breaks inside a removed snippet go too.
  const texts: Text[] = [];
  const starts: number[] = [];
  const brs: { el: Element; at: number }[] = [];
  let full = "";
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      texts.push(n as Text);
      starts.push(full.length);
      full += (n as Text).data;
    } else if ((n as Element).tagName === "BR") {
      brs.push({ el: n as Element, at: full.length });
    }
  }
  const ranges = snippetRanges(full, snippets);
  if (ranges.length === 0) return { html, removed: 0 };

  const touched = new Set<Node>();
  for (const [s, e] of [...ranges].reverse()) {
    for (let i = texts.length - 1; i >= 0; i--) {
      const node = texts[i]!;
      const from = Math.max(s, starts[i]!) - starts[i]!;
      const to = Math.min(e, starts[i]! + node.data.length) - starts[i]!;
      if (to <= from) continue;
      node.data = node.data.slice(0, from) + node.data.slice(to);
      touched.add(node);
    }
    for (const b of brs) if (b.at > s && b.at < e) b.el.remove();
  }
  // Drop elements the removal left empty (no text, pictures or tables), so no blank gaps remain.
  for (const node of touched) {
    let el = node.parentElement;
    while (el && el !== body && !el.textContent?.trim() && !el.querySelector("img,table,hr")) {
      const parent = el.parentElement;
      el.remove();
      el = parent;
    }
  }
  return { html: body.innerHTML, removed: ranges.length };
}

// The email as plain text (for sharing), from its text part or its HTML.
export function htmlToText(html: string) {
  const marked = html.replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, "\n");
  return new DOMParser().parseFromString(marked, "text/html").body.textContent ?? "";
}
