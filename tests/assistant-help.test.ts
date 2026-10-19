// Settings › Assistant help (user request 2026-10-19) lists every MCP command and prompt exactly once, with the
// right kind (reads / needs Allow changes / needs Allow staff actions / prompt) and a hint and example to show.
import { describe, expect, it } from "vitest";
import { HELP_GROUPS } from "../src/shared/assistantHelp";
import { ALL_TOOLS } from "../src/server/mcp/server";
import { PROMPTS } from "../src/server/mcp/prompts";

const entries = HELP_GROUPS.flatMap((g) => g.commands);

describe("assistant help", () => {
  it("covers every command and prompt once", () => {
    const names = entries.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names)).toEqual(new Set([...ALL_TOOLS.map((t) => t.name), ...PROMPTS.map((p) => p.name)]));
  });

  it("marks what each one needs, as the server enforces it", () => {
    for (const c of entries) {
      const tool = ALL_TOOLS.find((t) => t.name === c.name);
      const kind = !tool ? "prompt" : tool.staff ? "staff" : tool.write ? "change" : "read";
      expect(c.kind, c.name).toBe(kind);
      expect(c.hint.length, c.name).toBeGreaterThan(20);
      expect(c.example.length, c.name).toBeGreaterThan(5);
    }
  });

  it("uses the same titles as the assistant log", () => {
    for (const t of ALL_TOOLS) expect(entries.find((c) => c.name === t.name)!.title, t.name).toBe(t.title);
    for (const p of PROMPTS) expect(entries.find((c) => c.name === p.name)!.title, p.name).toBe(p.title);
  });
});
