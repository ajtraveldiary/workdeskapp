import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// App version, worked out from git when the dashboard is built: MAJOR.MINOR.
//  - MINOR counts commits since the last major release, so every commit raises it by one.
//  - A major release is marked with a git tag like "v2" (git tag v2); the version then reads 2.0.
//  - With no tag yet, MAJOR is 1 and MINOR counts every commit.
function appVersion(): string {
  const git = (cmd: string) => execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    try {
      const tag = git('describe --tags --abbrev=0 --match "v[0-9]*"'); // latest major tag, e.g. "v2"
      return `${tag.replace(/^v/, "").split(".")[0]}.${git(`rev-list --count ${tag}..HEAD`)}`;
    } catch {
      return `1.${git("rev-list --count HEAD")}`;
    }
  } catch {
    return "dev"; // not a git checkout
  }
}

const version = appVersion();

// dist/version.json names the build, so open copies of the app can notice a newer one and reload (see
// src/client/autoUpdate.ts; 2026-10-06: home-screen apps on iPhones kept showing old versions).
const versionFile = {
  name: "workdesk-version-file",
  generateBundle(this: { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }) {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version }) });
  },
};

// dist/sw.js, the offline helper (src/sw/sw.js, user request 2026-10-07), stamped with this build's version
// so every deploy installs a fresh copy and drops the old saved app files.
const serviceWorker = {
  name: "workdesk-service-worker",
  generateBundle(this: { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }) {
    const source = readFileSync(new URL("./src/sw/sw.js", import.meta.url), "utf8").replace("__WORKDESK_VERSION__", version);
    this.emitFile({ type: "asset", fileName: "sw.js", source });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile, serviceWorker],
  root: "src/client",
  build: { outDir: "../../dist", emptyOutDir: true },
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    proxy: { "/api/": "http://localhost:8787" },
  },
});
