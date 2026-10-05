import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { findPart, parseMessage } from "../src/server/lib/emailContent";
import type { GmailFullMessage } from "../src/server/lib/gmail";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

const message: GmailFullMessage = {
  id: "m1",
  threadId: "t1",
  internalDate: "1790000000000",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: '"District Office" <do@example.gov>' },
      { name: "To", value: "clerk@example.gov" },
      { name: "Subject", value: "Statement" },
    ],
    parts: [
      {
        partId: "0",
        mimeType: "multipart/alternative",
        parts: [
          { partId: "0.0", mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="iso-8859-1"' }], body: { data: b64(Buffer.from([0x43, 0x61, 0x66, 0xe9])) } },
          { partId: "0.1", mimeType: "text/html", body: { data: b64('<p>Please see <img src="cid:logo@x"></p>') } },
        ],
      },
      { partId: "1", mimeType: "application/pdf", filename: "statement.pdf", body: { size: 52000, attachmentId: "ATT1" } },
      {
        partId: "2",
        mimeType: "image/png",
        filename: "logo.png",
        headers: [{ name: "Content-ID", value: "<logo@x>" }, { name: "Content-Disposition", value: "inline" }],
        body: { size: 300, attachmentId: "ATT2" },
      },
    ],
  },
};

describe("parseMessage", () => {
  const m = parseMessage(message);

  it("reads headers, HTML and text (decoding the declared charset)", () => {
    expect(m).toMatchObject({ fromName: "District Office", fromEmail: "do@example.gov", to: "clerk@example.gov", subject: "Statement" });
    expect(m.html).toContain("Please see");
    expect(m.text).toBe("Café");
  });

  it("lists attachments, marking embedded images as inline", () => {
    expect(m.attachments).toEqual([
      { partId: "1", filename: "statement.pdf", mimeType: "application/pdf", size: 52000, contentId: null, inline: false },
      { partId: "2", filename: "logo.png", mimeType: "image/png", size: 300, contentId: "logo@x", inline: true },
    ]);
  });

  it("finds a part by id for downloading", () => {
    expect(findPart(message, "1")?.body?.attachmentId).toBe("ATT1");
    expect(findPart(message, "9")).toBeNull();
  });
});
