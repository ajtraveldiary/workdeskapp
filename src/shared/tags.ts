// Tags on tasks and reminders (user request 2026-10-11; user's choices: a colour per tag, a reminder's tags copied
// to its tasks, a Tags column in the Tasks & Reminders CSV, compact chips on rows). WorkDesk-only: tags never
// touch Gmail and are separate from Gmail labels (which belong to emails and sections). Shared by both sides.

// The palette; each name has a light and a dark look in styles.css (.tag-chip[data-color]).
export const TAG_COLORS = ["grey", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_COLOR_NAMES: Record<TagColor, string> = {
  grey: "Grey",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

export const MAX_TAG_NAME = 40;
export const MAX_TAGS_PER_ITEM = 20;

// Tag names are kept as typed (spaces tidied); two names are the same tag whatever their capitals.
export const tidyTagName = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_NAME);
export const tagKey = (s: string) => tidyTagName(s).toLowerCase();

// A CSV "Tags" cell: names separated by commas, semicolons or new lines.
export function splitTagNames(v: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v.split(/[,;\n]/)) {
    const name = tidyTagName(raw);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out.slice(0, MAX_TAGS_PER_ITEM);
}

// The colour a new tag gets when none is chosen (e.g. made by a CSV import): the next one round the palette.
export const nextTagColor = (count: number): TagColor => TAG_COLORS[(count + 6) % TAG_COLORS.length]!;
