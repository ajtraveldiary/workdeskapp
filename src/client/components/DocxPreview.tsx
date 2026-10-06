// Word attachments (.docx) shown inside WorkDesk (user request 2026-10-06): converted to plain HTML in the
// browser with mammoth and shown in a sandboxed frame (no scripts; only embedded pictures). Loaded on demand.
import { useEffect, useMemo, useRef, useState } from "react";
import mammoth from "mammoth/mammoth.browser";
import { Loading } from "./ui";
import { MALAYALAM_FONT } from "../fonts";

const STYLE =
  MALAYALAM_FONT +
  'html,body{margin:0;background:#fff}body{padding:16px;font:14px/1.6 "Segoe UI","Noto Sans Malayalam",system-ui,-apple-system,sans-serif;color:#1c1d26;overflow-wrap:anywhere}' +
  "img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%;margin:8px 0}td,th{border:1px solid #d5d9e2;padding:4px 6px;vertical-align:top}" +
  "p{margin:0 0 8px}h1,h2,h3{line-height:1.3;margin:12px 0 8px}h1{font-size:20px}h2{font-size:17px}h3{font-size:15px}";

export default function DocxPreview({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const out = await mammoth.convertToHtml({ arrayBuffer: await res.arrayBuffer() });
        if (!cancelled) setHtml(out.value || "<p>(This document has no text.)</p>");
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return <p className="py-12 text-center text-sm text-slate-500">This document couldn't be shown. Download it to open.</p>;
  if (html === null) return <Loading label="Loading document…" />;
  return <DocFrame html={html} />;
}

function DocFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'self'"><base target="_blank"><style>${STYLE}</style></head><body>${html}</body></html>`,
    [html],
  );
  // Grow the frame to fit the document, so the page scrolls rather than the frame.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const fit = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      frame.style.height = `${doc.documentElement.scrollHeight}px`;
      observer?.disconnect();
      observer = new ResizeObserver(() => (frame.style.height = `${doc.documentElement.scrollHeight}px`));
      observer.observe(doc.body);
    };
    frame.addEventListener("load", fit);
    if (frame.contentDocument?.readyState === "complete") fit();
    return () => {
      frame.removeEventListener("load", fit);
      observer?.disconnect();
    };
  }, [srcDoc]);
  return <iframe ref={ref} title="Document" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={srcDoc} className="block min-h-40 w-full rounded-md border border-line bg-white" />;
}
