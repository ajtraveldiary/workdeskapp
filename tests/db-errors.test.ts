import { describe, expect, it } from "vitest";
import { classifyDbError } from "../src/server/lib/dbErrors";

const neon = (message: string) => Object.assign(new Error(message), { name: "NeonDbError" });
const wrapped = (cause: Error) => Object.assign(new Error('Failed query: select "id" from "users" where "id" = $1\nparams: abc'), { name: "DrizzleQueryError", cause });

describe("database errors shown to the user", () => {
  it("spots Neon's usage-limit pauses, also when drizzle wraps them", () => {
    for (const m of [
      "Your project has exceeded the compute time quota. Upgrade your plan to increase limits.",
      "Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.",
      "could not extend file because project size limit (512 MB) has been exceeded",
      "The endpoint has been disabled. Enable it using Neon API and retry.",
    ]) {
      expect(classifyDbError(neon(m))?.code).toBe("database_paused");
      const w = classifyDbError(wrapped(neon(m)));
      expect(w?.code).toBe("database_paused");
      expect(w?.detail).not.toContain("select"); // no SQL in what the user sees
    }
  });

  it("reports other database failures as a database error", () => {
    expect(classifyDbError(neon("Couldn't connect to compute node"))?.code).toBe("database_error");
    expect(classifyDbError(wrapped(new TypeError("fetch failed")))?.code).toBe("database_error");
  });

  it("leaves ordinary bugs alone", () => {
    expect(classifyDbError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBeNull();
    expect(classifyDbError(new Error("Gmail said 429: rate limit"))).toBeNull();
    expect(classifyDbError(new TypeError("fetch failed"))).toBeNull(); // e.g. a Gmail call
    expect(classifyDbError(new Error("Quota exceeded for quota metric 'Queries' (Gmail API)"))).toBeNull();
  });
});

describe("API answer when the database is paused", () => {
  it("returns 503 with a code the app shows a pop-up for", async () => {
    const { createApp } = await import("../src/server/app");
    const app = createApp({
      getDb: () => {
        throw neon("Your project has exceeded the compute time quota. Upgrade your plan to increase limits.");
      },
      allowDemo: true,
    });
    const res = await app.request("/api/me", {}, {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; error: string; detail: string };
    expect(body.code).toBe("database_paused");
    expect(body.detail).toContain("compute time quota");
  });
});
