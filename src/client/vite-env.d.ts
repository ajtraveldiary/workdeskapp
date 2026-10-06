/// <reference types="vite/client" />

// Set at build time from git (see vite.config.ts): MAJOR.MINOR, e.g. "1.14".
declare const __APP_VERSION__: string;

// mammoth's ready-made browser build (Word .docx → HTML for attachment previews); it ships no types.
declare module "mammoth/mammoth.browser" {
  const mammoth: { convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }> };
  export default mammoth;
}
