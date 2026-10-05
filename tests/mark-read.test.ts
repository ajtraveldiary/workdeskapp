import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailError, canMarkRead, markThreadRead } from "../src/server/lib/gmail";

afterEach(() => vi.unstubAllGlobals());

describe("markThreadRead", () => {
  it("sends exactly one request: remove UNREAD from that thread", async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await markThreadRead("tok", "18f2a9c0b1");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/threads/18f2a9c0b1/modify");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ removeLabelIds: ["UNREAD"] });
  });

  it("refuses odd thread ids and reports Gmail errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    await expect(markThreadRead("tok", "../trash")).rejects.toThrow("Invalid Gmail thread id");
    await expect(markThreadRead("tok", "abc")).rejects.toBeInstanceOf(GmailError);
  });

  it("knows which sign-ins allow it", () => {
    expect(canMarkRead("openid https://www.googleapis.com/auth/gmail.modify")).toBe(true);
    expect(canMarkRead("openid https://www.googleapis.com/auth/gmail.readonly")).toBe(false);
    expect(canMarkRead(null)).toBe(false);
  });
});
