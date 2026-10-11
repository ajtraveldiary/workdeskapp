import { defineConfig } from "vitest/config";

// Each test file builds a fresh in-memory database and applies every migration before its first test. On
// machines with many cores Vitest starts dozens of files at once and that setup could pass the default 10s
// limit (2026-10-11: 18 timeouts on a 32-thread PC), so runs are capped at 8 files, setup gets 30s and each
// test 20s (a few take 3-7s while other files run alongside).
export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    maxWorkers: 8,
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
