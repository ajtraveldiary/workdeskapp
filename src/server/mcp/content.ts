// Turning emails and attachments into text an assistant can read (MCP server, docs/MCP_PLAN.md). Workers have no
// DOMParser, so HTML is flattened with patterns: good enough for reading, never shown to anyone as HTML.
// Attachments: PDF text (unpdf, pdf.js for servers), Excel / ODS / CSV sheets (SheetJS), Word .docx and
// PowerPoint .pptx text (unzipped with fflate), plain text, and pictures as images. The office libraries load only
// when such a file is read.
import { strFromU8, unzipSync } from "fflate";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", rupee: "₹", zwj: "‍", zwnj: "‌" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// Readable text from an email's HTML: paragraphs and line breaks kept, table cells separated by " | ", list items
// with "- ", links as "text (address)" when the address isn't the text itself.
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title|xml)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const url = decodeEntities(href);
      if (!text) return "";
      if (!/^https?:/i.test(url) || decodeEntities(text).replace(/^mailto:/, "") === url.replace(/^mailto:/, "") || url.includes(decodeEntities(text))) return inner;
      return `${inner} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|blockquote|section|article|header|footer)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|table|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n---\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return tidy(s);
}

// Collapse runs of spaces and blank lines.
export function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\| *\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Attachments ---

export type AttachmentText =
  | { kind: "text"; format: string; text: string; pages?: number; note?: string }
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "pdf_scanned"; pages: number; base64: string | null; note: string }
  | { kind: "unsupported"; note: string };

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
// Pictures and scanned PDFs are passed on as files up to this size.
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const xmlText = (xml: string) =>
  decodeEntities(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<(w:br|a:br)\b[^>]*\/>/g, "\n")
      .replace(/<\/w:tc>/g, " | ")
      .replace(/<\/(w:p|w:tr|a:p)>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );

function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => /^word\/(document|footnotes|endnotes)\.xml$/.test(f.name) });
  const main = files["word/document.xml"];
  if (!main) throw new Error("Not a Word file");
  return tidy(xmlText(strFromU8(main)));
}

function pptxText(bytes: Uint8Array): { text: string; pages: number } {
  const files = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  const names = Object.keys(files).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const text = names.map((n, i) => `--- Slide ${i + 1} ---\n${tidy(xmlText(strFromU8(files[n]!)))}`).join("\n\n");
  return { text, pages: names.length };
}

const ROW_LIMIT = 1000;

async function sheetText(bytes: Uint8Array): Promise<{ text: string; pages: number; note?: string }> {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const pad = (n: number) => String(n).padStart(2, "0");
  let cut = false;
  const parts = wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: "", blankrows: false });
    if (rows.length > ROW_LIMIT) cut = true;
    const lines = rows.slice(0, ROW_LIMIT).map((r) =>
      r
        .map((v) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : String(v ?? "").replace(/\s+/g, " ").trim()))
        .join(" | ")
        .replace(/( \| )+$/, ""),
    );
    return `--- Sheet: ${name} (${rows.length} rows) ---\n${lines.join("\n")}`;
  });
  return { text: parts.join("\n\n"), pages: wb.SheetNames.length, note: cut ? `Only the first ${ROW_LIMIT} rows of each sheet are included. Dates are YYYY-MM-DD; cells are separated by " | ".` : 'Dates are YYYY-MM-DD; cells are separated by " | ".' };
}

async function pdfText(bytes: Uint8Array): Promise<AttachmentText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(doc, { mergePages: false });
  const pages = (text as string[]).map((t) => tidy(t));
  const letters = pages.join("").replace(/\s/g, "").length;
  // Next to no text: a scanned paper. Pass the file on so an assistant that reads PDFs as pictures can look.
  if (letters < 20 * Math.max(1, totalPages)) {
    return {
      kind: "pdf_scanned",
      pages: totalPages,
      base64: bytes.length <= MAX_FILE_BYTES ? toBase64(bytes) : null,
      note: "This PDF has no text layer (probably a scanned paper)." + (bytes.length <= MAX_FILE_BYTES ? " The PDF file itself is attached for reading as pictures." : " It is too large to pass on."),
    };
  }
  return { kind: "text", format: "pdf", pages: totalPages, text: pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join("\n\n") };
}

// Read one attachment. mime is the type WorkDesk serves it with (realMime).
export async function readAttachment(bytes: Uint8Array, filename: string, mime: string): Promise<AttachmentText> {
  const e = ext(filename);
  try {
    if (mime === "application/pdf" || e === "pdf") return await pdfText(bytes);
    if (IMAGE_TYPES[e] || /^image\/(png|jpeg|gif|webp)$/.test(mime)) {
      if (bytes.length > MAX_FILE_BYTES) return { kind: "unsupported", note: `The picture is ${(bytes.length / 1048576).toFixed(1)} MB, too large to pass on.` };
      return { kind: "image", mimeType: IMAGE_TYPES[e] ?? mime, base64: toBase64(bytes) };
    }
    if (["xlsx", "xlsm", "xls", "ods", "csv"].includes(e)) return { kind: "text", format: e, ...(await sheetText(bytes)) };
    if (e === "docx") return { kind: "text", format: "docx", text: docxText(bytes) };
    if (e === "pptx") return { kind: "text", format: "pptx", ...pptxText(bytes) };
    if (["txt", "md", "json", "xml", "log", "ics", "vcf"].includes(e) || mime.startsWith("text/")) {
      const raw = new TextDecoder("utf-8").decode(bytes);
      return { kind: "text", format: e || "text", text: e === "html" || e === "htm" || mime === "text/html" ? htmlToText(raw) : raw };
    }
    if (e === "html" || e === "htm") return { kind: "text", format: "html", text: htmlToText(new TextDecoder("utf-8").decode(bytes)) };
    if (e === "doc" || e === "ppt") return { kind: "unsupported", note: `Old .${e} files can't be read here; ask the sender for a .${e}x or PDF copy.` };
  } catch (err) {
    return { kind: "unsupported", note: `Couldn't read this file: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { kind: "unsupported", note: `Files of this type (${e ? `.${e}` : mime}) can't be read.` };
}
