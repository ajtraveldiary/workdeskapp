// Hidden text (Settings > Mail, user request 2026-10-06): find saved snippets such as signatures in an email and
// leave them out. Emails rarely repeat a snippet character for character (line breaks, spacing and capitals
// differ, HTML splits text across tags, and plain-text copies add *bold* marks), so matching ignores
// whitespace, those marks and case.

// Ignored when matching: whitespace, plus marks that plain-text versions of emails add around formatting
// (Gmail writes *bold* and _italic_; quoted lines start with >) and invisible zero-width characters.
const SKIP = /[\s*_~>\u200b-\u200d\u2060\ufeff]/u;
const MARK = /[*_~\u200b-\u200d\u2060\ufeff]/u;

// The text without whitespace, lower-cased, with each kept character's index in the original.
function squeeze(text: string) {
  let norm = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (SKIP.test(ch)) continue;
    norm += ch.toLowerCase();
    at.push(i);
  }
  return { norm, at };
}

// Shorter snippets would match too much of ordinary text.
const MIN_CHARS = 3;

// Where the snippets occur in `text`: merged [start, end) ranges in original indices.
export function snippetRanges(text: string, snippets: string[]): [number, number][] {
  const { norm, at } = squeeze(text);
  const ranges: [number, number][] = [];
  for (const snippet of snippets) {
    const needle = squeeze(snippet).norm;
    if (needle.length < MIN_CHARS) continue;
    for (let i = norm.indexOf(needle); i !== -1; i = norm.indexOf(needle, i + needle.length)) {
      // Take in formatting marks right against the match too, e.g. the * of "*Regards ... email:*".
      let start = at[i]!;
      let end = at[i + needle.length - 1]! + 1;
      while (start > 0 && MARK.test(text[start - 1]!)) start--;
      while (end < text.length && MARK.test(text[end]!)) end++;
      ranges.push([start, end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

// Plain text with the snippets taken out (and the blank lines they leave tidied).
export function stripSnippets(text: string, snippets: string[]): { text: string; removed: number } {
  const ranges = snippetRanges(text, snippets);
  if (ranges.length === 0) return { text, removed: 0 };
  let out = text;
  for (const [s, e] of [...ranges].reverse()) out = out.slice(0, s) + out.slice(e);
  // Lines left holding only marks (the "**" after a plain-text signature) go too.
  out = out.replace(/^[ \t*_~]+$/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, removed: ranges.length };
}
