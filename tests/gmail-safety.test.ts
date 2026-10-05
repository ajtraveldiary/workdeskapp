// Gmail safety. WorkDesk reads Gmail and makes only the changes the user approved (2026-10-06):
//  - marking a conversation read when it's opened in WorkDesk, and
//  - managing the user's own labels (create / rename / recolour / delete, and add/remove them on a conversation).
// This test fails if any other Gmail write appears (trash, delete emails, archive, send, drafts, filters,
// batch edits), if system labels could be changed through the label tools, or if the scope widens.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GMAIL_SCOPES, deleteLabel, isUserLabelId, setThreadLabels, updateLabel } from "../src/server/lib/gmail";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

const sources = files("src").map((f) => ({ file: f.replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));
const GMAIL_CLIENT = "src/server/lib/gmail.ts";
const client = readFileSync(GMAIL_CLIENT, "utf8");

const FORBIDDEN = [
  /\/trash\b/i,
  /\/untrash\b/i,
  /batchDelete/i,
  /batchModify/i,
  /messages\/send/i,
  /\/drafts\b/i,
  /\/filters\b/i,
  /\/settings\//i,
  /gmail\.compose/i,
  /gmail\.send/i,
  /gmail\.insert/i,
  /gmail\.settings/i,
  /mail\.google\.com\/(?!mail\/\?authuser)/i, // full-access scope; links to open Gmail are fine
];

afterEach(() => vi.unstubAllGlobals());

describe("Gmail safety", () => {
  it("requests gmail.modify and nothing broader", () => {
    const gmailScopes = GMAIL_SCOPES.filter((s) => s.includes("googleapis.com/auth/gmail"));
    expect(gmailScopes).toEqual(["https://www.googleapis.com/auth/gmail.modify"]);
  });

  it("contains no unapproved Gmail write operations anywhere in the app", () => {
    const offenders: string[] = [];
    for (const { file, text } of sources) for (const re of FORBIDDEN) if (re.test(text)) offenders.push(`${file}: ${re}`);
    expect(offenders).toEqual([]);
  });

  it("only the Gmail client talks to Gmail, and its writes are limited to the approved routes", () => {
    const outside = sources.filter(({ file, text }) => file !== GMAIL_CLIENT && /gmail\.googleapis\.com/.test(text)).map((s) => s.file);
    expect(outside).toEqual([]);
    const routes = client.slice(client.indexOf("const WRITE_ROUTES"), client.indexOf("];", client.indexOf("const WRITE_ROUTES")));
    expect(routes.match(/method: "(POST|PATCH|DELETE)", path: \/[^\n]+\//g)).toEqual([
      'method: "POST", path: /^\\/labels$/',
      'method: "PATCH", path: /^\\/labels\\/Label_[\\w-]+$/',
      'method: "DELETE", path: /^\\/labels\\/Label_[\\w-]+$/',
      'method: "POST", path: /^\\/threads\\/[\\w-]+\\/modify$/',
    ]);
    // Label edits on a conversation: only mark-read (UNREAD) and the label tools' own lists.
    const labelEdits = sources.flatMap(({ text }) => (text.match(/(add|remove)LabelIds[^\n]*/g) ?? []).map((l) => l.trim()));
    expect(labelEdits).toEqual(['removeLabelIds: ["UNREAD"] }),', "addLabelIds: add, removeLabelIds: remove });"]);
  });

  it("makes requests only through the known helpers", () => {
    expect(client.match(/fetch\(/g)?.length).toBe(4); // gmailGet, markThreadRead, gmailWrite, Google's OAuth token endpoint
    const gmailGet = client.slice(client.indexOf("async function gmailGet"), client.indexOf("export type GmailHeader"));
    expect(gmailGet).toContain('method: "GET"');
  });

  it("refuses system labels, so the label tools can't archive, trash or mark anything", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const system of ["INBOX", "TRASH", "SPAM", "UNREAD", "STARRED", "IMPORTANT", "CATEGORY_PROMOTIONS"]) {
      expect(isUserLabelId(system)).toBe(false);
      expect(() => setThreadLabels("tok", "t1", [system], [])).toThrow();
      expect(() => setThreadLabels("tok", "t1", [], [system])).toThrow(); // removing INBOX would archive
      expect(() => updateLabel("tok", system, { name: "x" })).toThrow();
      expect(() => deleteLabel("tok", system)).toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(isUserLabelId("Label_12")).toBe(true);
  });
});
