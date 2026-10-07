// Links kept with a reminder (user request 2026-10-07): the Google Sheet, Doc or Drive file needed for it.
// No previews: a tap opens the link in Google's app or website. LinkChips shows them on reminder rows and in
// task details; LinksEditor adds and removes them in the reminder form.
import { File, FileSpreadsheet, FileText, Folder, Link2, ClipboardList, Plus, Presentation, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import type { ReminderLink } from "../../shared/types";
import { cx, inputClass } from "./ui";

type Kind = { label: string; icon: LucideIcon; color: string };
const KINDS: Record<string, Kind> = {
  sheet: { label: "Google Sheet", icon: FileSpreadsheet, color: "text-[#188038] dark:text-[#5bd47f]" },
  doc: { label: "Google Doc", icon: FileText, color: "text-[#1a73e8] dark:text-[#7aaaff]" },
  slides: { label: "Google Slides", icon: Presentation, color: "text-[#e8a200] dark:text-[#ffd75e]" },
  form: { label: "Google Form", icon: ClipboardList, color: "text-[#7248b9] dark:text-[#c9a8ff]" },
  folder: { label: "Drive folder", icon: Folder, color: "text-slate-500" },
  file: { label: "Drive file", icon: File, color: "text-slate-500" },
  web: { label: "Link", icon: Link2, color: "text-slate-500" },
};

export function linkKind(url: string): Kind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return KINDS.web!;
  }
  if (u.hostname === "docs.google.com") {
    if (u.pathname.startsWith("/spreadsheets")) return KINDS.sheet!;
    if (u.pathname.startsWith("/document")) return KINDS.doc!;
    if (u.pathname.startsWith("/presentation")) return KINDS.slides!;
    if (u.pathname.startsWith("/forms")) return KINDS.form!;
  }
  if (u.hostname === "forms.gle") return KINDS.form!;
  if (u.hostname === "drive.google.com") return u.pathname.includes("/folders/") ? KINDS.folder! : KINDS.file!;
  return KINDS.web!;
}

export const linkName = (l: ReminderLink) => l.name.trim() || linkKind(l.url).label;

// Tappable chips that open each link (in a new tab, or the Google app on a phone).
export function LinkChips({ links, className }: { links: ReminderLink[] | undefined; className?: string }) {
  if (!links?.length) return null;
  return (
    <div className={cx("flex flex-wrap gap-1.5", className)}>
      {links.map((l, i) => {
        const k = linkKind(l.url);
        return (
          <a
            key={`${l.url}-${i}`}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            title={l.url}
            className="inline-flex max-w-full min-w-0 items-start gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-left text-footnote text-ink hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]"
          >
            <k.icon size={13} className={cx("mt-[3px] shrink-0", k.color)} aria-hidden />
            {/* Long (Malayalam) names wrap to two lines rather than being cut to a few words. */}
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{linkName(l)}</span>
          </a>
        );
      })}
    </div>
  );
}

// In the reminder form: paste a link, optionally name it, Add. Saved with the reminder.
const fullUrl = (raw: string) => {
  const clean = raw.trim();
  const full = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(full) ? full : null;
};

// onDraft: a link typed but not yet added (or null), so saving the form keeps it too.
export function LinksEditor({ links, onChange, onDraft }: { links: ReminderLink[]; onChange: (links: ReminderLink[]) => void; onDraft: (l: ReminderLink | null) => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const full = url.trim() ? fullUrl(url) : null;
    onDraft(full && !links.some((l) => l.url === full) ? { url: full, name: name.trim() } : null);
  }, [url, name, links, onDraft]);
  const add = () => {
    if (!url.trim()) return;
    const full = fullUrl(url);
    if (!full) return setError("Paste a full link, e.g. https://docs.google.com/…");
    if (links.some((l) => l.url === full)) return setError("This link is already added.");
    onChange([...links, { url: full, name: name.trim() }]);
    setUrl("");
    setName("");
    setError(null);
  };
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // adds the link instead of saving the whole form
    add();
  };

  return (
    <div>
      <span className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
        Links
        <span className="text-footnote font-normal text-slate-400">Optional</span>
      </span>
      {links.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {links.map((l, i) => {
            const k = linkKind(l.url);
            return (
              <li key={`${l.url}-${i}`} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                <k.icon size={18} className={cx("shrink-0", k.color)} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm text-ink [overflow-wrap:anywhere]">{linkName(l)}</span>
                  <span className="block truncate text-caption text-slate-500">{l.url.replace(/^https?:\/\//, "")}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onChange(links.filter((_, j) => j !== i))}
                  aria-label={`Remove link: ${linkName(l)}`}
                  title="Remove link"
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink active:scale-90 pointer-coarse:p-1.5"
                >
                  <X size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-2">
        {/* Plain text (not type="url"), so a link pasted without https:// doesn't block saving; it is added. */}
        <input
          type="text"
          inputMode="url"
          className={inputClass}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={onEnter}
          placeholder="Paste a Google Drive, Sheet or Doc link"
          aria-label="Link"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {url.trim() && (
          <div className="flex gap-2">
            <input
              className={cx(inputClass, "flex-1")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
              placeholder={`Name (optional), e.g. ${linkKind(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`).label}`}
              aria-label="Link name"
              maxLength={120}
            />
            <button
              type="button"
              onClick={add}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 text-sm text-slate-700 enabled:hover:bg-slate-50 active:scale-[0.97]"
            >
              <Plus size={15} /> Add
            </button>
          </div>
        )}
        {error && <p className="text-footnote text-urgent-ink">{error}</p>}
      </div>
    </div>
  );
}
