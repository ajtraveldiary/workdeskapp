// "All destructive Gmail operations should be absent from the application's implementation."
// This test fails if any server or client code mentions a Gmail write operation or a broader scope.
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

const FORBIDDEN = [
  /\/trash\b/i,
  /\/untrash\b/i,
  /batchDelete/i,
  /batchModify/i,
  /\/modify\b/i,
  /messages\/send/i,
  /\/drafts\b/i,
  /\/labels\b/i,
  /\/filters\b/i,
  /gmail\.modify/i,
  /gmail\.compose/i,
  /gmail\.send/i,
  /gmail\.insert/i,
  /gmail\.labels/i,
  /gmail\.settings/i,
  /mail\.google\.com\/(?!mail\/\?authuser)/i, // full-access scope; links to open Gmail are fine
];

describe("Gmail safety", () => {
  it("requests only read-only Gmail access", () => {
    const gmailScopes = GMAIL_SCOPES.filter((s) => s.includes("googleapis.com/auth/gmail"));
    expect(gmailScopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });

  it("contains no Gmail write operations anywhere in the app", () => {
    const offenders: string[] = [];
    for (const f of files("src")) {
      const text = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) if (re.test(text)) offenders.push(`${f}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it("issues Gmail API requests only with GET", () => {
    const text = readFileSync("src/server/lib/gmail.ts", "utf8");
    const gmailFetch = text.slice(text.indexOf("async function gmailGet"), text.indexOf("export type GmailHeader"));
    expect(gmailFetch).toContain('method: "GET"');
    expect(text.match(/fetch\(/g)?.length).toBe(2); // gmailGet + Google's OAuth token endpoint
  });
});
