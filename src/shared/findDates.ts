// Due date suggested from an email's text (user request 2026-10-06): when an email becomes a task, a date
// written in the email is the task's default due date unless the user picks one. Dates are read the Indian way
// (day first): 24/09/2026, 24.09.26, 24-9-2026, 2026-09-24, 24th September 2026, 24 Sept, September 24, 2026.
// The earliest date from today on is used (it's most likely the deadline); past dates (letter dates,
// references) and dates more than two years ahead are ignored. Dates without a year count only if they are
// still to come this year.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";

// [regex, which groups hold day, month, year]
const PATTERNS: { re: RegExp; d: number; m: number; y: number; named?: boolean }[] = [
  // 24/09/2026, 24.09.2026, 24-09-26 (same separator twice; not part of a longer number like a file number)
  { re: /(?<![\w/.-])(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?![\w/-]|\.\d)/g, d: 1, m: 3, y: 4 },
  // 2026-09-24
  { re: /(?<![\w/.-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\w/-]|\.\d)/g, d: 3, m: 2, y: 1 },
  // 24th September 2026, 24 Sept, 24-Sep-2026, 24th of September
  { re: new RegExp(`(?<![\\w])${DAY}(?:\\s+of)?[\\s\\-.,]*${MONTH}(?:[\\s\\-.,]*(\\d{4}))?(?![\\w])`, "gi"), d: 1, m: 2, y: 3, named: true },
  // September 24, 2026, Sept 24th
  { re: new RegExp(`(?<![\\w])${MONTH}\\s+${DAY}(?:,?\\s*(\\d{4}))?(?![\\w])`, "gi"), d: 2, m: 1, y: 3, named: true },
];

const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// today: YYYY-MM-DD. Returns YYYY-MM-DD or null.
export function findDueDate(text: string, today: string): string | null {
  if (!text) return null;
  const thisYear = Number(today.slice(0, 4));
  const latest = `${thisYear + 2}${today.slice(4)}`;
  let best: string | null = null;
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const day = Number(m[p.d]);
      const monthRaw = m[p.m]!;
      const month = p.named ? MONTHS[monthRaw.toLowerCase().replace(/\.$/, "")] ?? 0 : Number(monthRaw);
      const yRaw = m[p.y];
      const year = !yRaw ? thisYear : yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
      if (!valid(year, month, day)) continue;
      const iso = `${year}-${pad(month)}-${pad(day)}`;
      if (iso < today || iso > latest) continue;
      if (!best || iso < best) best = iso;
    }
  }
  return best;
}
