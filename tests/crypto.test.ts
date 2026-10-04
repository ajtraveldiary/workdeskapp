import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, signPayload, verifyPayload } from "../src/server/lib/crypto";

const key = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

describe("crypto", () => {
  it("round-trips encrypted refresh tokens", async () => {
    const enc = await encryptSecret("1//refresh-token", key);
    expect(enc).not.toContain("refresh");
    expect(await decryptSecret(enc, key)).toBe("1//refresh-token");
  });

  it("rejects tampered sessions", async () => {
    const token = await signPayload({ uid: "u1", exp: 1 }, "secret");
    expect(await verifyPayload(token, "secret")).toEqual({ uid: "u1", exp: 1 });
    expect(await verifyPayload(token, "other")).toBeNull();
    expect(await verifyPayload(token.replace(/^./, "x"), "secret")).toBeNull();
  });
});
