// Email bodies and attachments for the viewer. Read from Gmail when opened and passed straight to the
// browser; nothing here is written to the database. The browser caches the responses, so an email or
// attachment is fetched from Gmail once per device (see the Cache-Control headers in routes/threads.ts).
import { Buffer } from "node:buffer";
import type { GmailFullMessage, GmailPart } from "./gmail";
import { parseFrom } from "./gmail";
import type { EmailAttachment, EmailMessageContent } from "../../shared/types";

const headerOf = (part: GmailPart | undefined, name: string) =>
  part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export function decodeBase64Url(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64url"));
}

function decodeText(part: GmailPart): string {
  const bytes = decodeBase64Url(part.body?.data ?? "");
  const charset = /charset="?([^";\s]+)"?/i.exec(headerOf(part, "Content-Type"))?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function walk(part: GmailPart | undefined, visit: (p: GmailPart) => void) {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) walk(child, visit);
}

export function parseMessage(m: GmailFullMessage): EmailMessageContent {
  let html: string | null = null;
  let text: string | null = null;
  const attachments: EmailAttachment[] = [];

  walk(m.payload, (p) => {
    const mime = (p.mimeType ?? "").toLowerCase();
    const isFile = !!p.filename || (!!p.body?.attachmentId && !mime.startsWith("text/"));
    if (isFile && p.partId !== undefined) {
      const contentId = headerOf(p, "Content-ID").replace(/^<|>$/g, "") || null;
      attachments.push({
        partId: p.partId,
        filename: p.filename || `attachment-${p.partId}`,
        mimeType: mime || "application/octet-stream",
        size: p.body?.size ?? 0,
        contentId,
        inline: /^inline/i.test(headerOf(p, "Content-Disposition")) && !!contentId,
      });
      return;
    }
    if (mime === "text/html" && html === null && p.body?.data) html = decodeText(p);
    if (mime === "text/plain" && text === null && p.body?.data) text = decodeText(p);
  });

  const from = parseFrom(headerOf(m.payload, "From"));
  return {
    id: m.id,
    fromName: from.name,
    fromEmail: from.email,
    to: headerOf(m.payload, "To"),
    cc: headerOf(m.payload, "Cc"),
    date: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    subject: headerOf(m.payload, "Subject"),
    html,
    text,
    attachments,
  };
}

export function findPart(m: GmailFullMessage, partId: string): GmailPart | null {
  let found: GmailPart | null = null;
  walk(m.payload, (p) => {
    if (p.partId === partId) found = p;
  });
  return found;
}

// --- Demo mode: sample content and a generated PDF, so the viewer can be tried without Gmail ---

export function demoContent(t: { gmailThreadId: string; subject: string; fromName: string | null; fromEmail: string | null; snippet: string; lastMessageAt: Date }): EmailMessageContent[] {
  return [
    {
      id: `${t.gmailThreadId}-m1`,
      fromName: t.fromName,
      fromEmail: t.fromEmail,
      to: "demo@localhost",
      cc: "",
      date: t.lastMessageAt.toISOString(),
      subject: t.subject,
      html: null,
      text: `Sir/Madam,\n\n${t.snippet}\n\nThe relevant document is attached for your reference. Kindly treat this as urgent.\n\nRegards,\n${t.fromName ?? "Office"}`,
      attachments: [{ partId: "1", filename: `${t.subject.slice(0, 40)}.pdf`, mimeType: "application/pdf", size: 900, contentId: null, inline: false }],
    },
  ];
}

// A small but valid one-page PDF with a few lines of text.
export function demoPdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "-");
  const content = [
    "BT /F1 18 Tf 72 760 Td (" + esc(title) + ") Tj ET",
    ...lines.map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${esc(l)}) Tj ET`),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
