// Gmail safety. WorkDesk reads Gmail, and makes exactly one kind of change, approved by the user on
// 2026-10-06: opening an email in the viewer removes its UNREAD label. This test fails if any other Gmail
// write (trash, delete, archive, labels, send, drafts, filters, batch edits) or a broader scope appears.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GMAIL_SCOPES } from "../src/server/lib/gmail";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

const sources = files("src").map((f) => ({ file: f.replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));
const GMAIL_CLIENT = "src/server/lib/gmail.ts";

const FORBIDDEN = [
  /\/trash\b/i,
  /\/untrash\b/i,
  /batchDelete/i,
  /batchModify/i,
  /messages\/send/i,
  /\/drafts\b/i,
  /\/labels\b/i,
  /\/filters\b/i,
  /addLabelIds/i,
  /gmail\.compose/i,
  /gmail\.send/i,
  /gmail\.insert/i,
  /gmail\.labels/i,
  /gmail\.settings/i,
  /mail\.google\.com\/(?!mail\/\?authuser)/i, // full-access scope; links to open Gmail are fine
];

describe("Gmail safety", () => {
  it("requests gmail.modify (read + mark read) and nothing broader", () => {
    const gmailScopes = GMAIL_SCOPES.filter((s) => s.includes("googleapis.com/auth/gmail"));
    expect(gmailScopes).toEqual(["https://www.googleapis.com/auth/gmail.modify"]);
  });

  it("contains no other Gmail write operations anywhere in the app", () => {
    const offenders: string[] = [];
    for (const { file, text } of sources) for (const re of FORBIDDEN) if (re.test(text)) offenders.push(`${file}: ${re}`);
    expect(offenders).toEqual([]);
  });

  it("allows exactly one change: removing UNREAD from a thread, only in the Gmail client", () => {
    const modifyCalls = sources.flatMap(({ file, text }) => (text.match(/\/modify`/g) ?? []).map(() => file));
    expect(modifyCalls).toEqual([GMAIL_CLIENT]);
    const client = readFileSync(GMAIL_CLIENT, "utf8");
    expect(client).toContain("`${GMAIL}/threads/${threadId}/modify`");
    // The only label edit in the codebase is removing UNREAD.
    const labelEdits = sources.flatMap(({ text }) => (text.match(/removeLabelIds[^\n]*/g) ?? []).map((l) => l.trim()));
    expect(labelEdits).toEqual(['removeLabelIds: ["UNREAD"] }),']);
  });

  it("uses GET for every Gmail request except the mark-read", () => {
    const client = readFileSync(GMAIL_CLIENT, "utf8");
    const gmailFetch = client.slice(client.indexOf("async function gmailGet"), client.indexOf("export type GmailHeader"));
    expect(gmailFetch).toContain('method: "GET"');
    expect(client.match(/fetch\(/g)?.length).toBe(3); // gmailGet, markThreadRead, Google's OAuth token endpoint
    expect(client.match(/method: "POST"/g)?.length).toBe(2); // markThreadRead and the OAuth token endpoint
    expect(client).not.toMatch(/method: "(DELETE|PUT|PATCH)"/);
  });
});
