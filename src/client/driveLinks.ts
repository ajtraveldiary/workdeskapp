// Google Docs, Sheets, Slides and Drive files sent as links in an email (Gmail's Drive "attachments"), so the
// email viewer can list and preview them next to real attachments (user request 2026-10-06).

export type DriveKind = "document" | "spreadsheets" | "presentation" | "file";
export type DriveLink = { id: string; kind: DriveKind; name: string; url: string; previewUrl: string };

export const DRIVE_KIND_LABEL: Record<DriveKind, string> = { document: "Google Doc", spreadsheets: "Google Sheet", presentation: "Google Slides", file: "Google Drive file" };

const DOCS = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]{20,})/;
const DRIVE = /^https:\/\/drive\.google\.com\/(?:u\/\d+\/)?(?:file\/d\/|open\?(?:.*&)?id=)([\w-]{20,})/;

// One link, unwrapping Google's redirect links (google.com/url?q=...).
export function parseDriveUrl(href: string): Omit<DriveLink, "name"> | null {
  let url = href.trim();
  try {
    const u = new URL(url);
    if (/(^|\.)google\.com$/.test(u.hostname) && u.pathname === "/url") url = u.searchParams.get("q") ?? u.searchParams.get("url") ?? url;
  } catch {
    return null;
  }
  const d = DOCS.exec(url);
  if (d) {
    const kind = d[1] as DriveKind;
    return { id: d[2]!, kind, url, previewUrl: `https://docs.google.com/${kind}/d/${d[2]}/preview` };
  }
  const f = DRIVE.exec(url);
  if (f) return { id: f[1]!, kind: "file", url, previewUrl: `https://drive.google.com/file/d/${f[1]}/preview` };
  return null;
}

const looksLikeUrl = (s: string) => /^(https?:\/\/|www\.)|^[\w-]+\.google\.com/i.test(s);

// The Google files linked in an email's HTML, once each, named by the link text when it isn't just the URL.
export function driveLinks(html: string | null): DriveLink[] {
  if (!html || !/google\.com/i.test(html)) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = new Map<string, DriveLink>();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const link = parseDriveUrl(a.getAttribute("href") ?? "");
    if (!link) continue;
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    const name = text && !looksLikeUrl(text) ? text : "";
    const seen = found.get(link.id);
    if (!seen) found.set(link.id, { ...link, name: name || DRIVE_KIND_LABEL[link.kind] });
    else if (name && seen.name === DRIVE_KIND_LABEL[seen.kind]) seen.name = name;
  }
  return [...found.values()];
}
