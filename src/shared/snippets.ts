// Hidden text (Settings > Mail, user request 2026-10-06): find saved snippets such as signatures in an email and
// leave them out. Emails rarely repeat a snippet character for character (line breaks, spacing and capitals
// differ, and HTML splits text across tags), so matching ignores whitespace and case.

const WS = /\s/u;

// The text without whitespace, lower-cased, with each kept character's index in the original.
function squeeze(text: string) {
  let norm = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (WS.test(ch)) continue;
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
      ranges.push([at[i]!, at[i + needle.length - 1]! + 1]);
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
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, removed: ranges.length };
}
