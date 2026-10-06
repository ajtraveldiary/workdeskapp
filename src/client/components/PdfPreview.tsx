// Renders a PDF's pages with pdf.js, so previews look the same on phones and desktops (mobile browsers
// can't show PDFs inside a page). Loaded on demand: this file and pdf.js are only fetched when a PDF opens.
import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loading } from "./ui";

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 50;

export default function PdfPreview({ url }: { url: string }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    const el = pagesRef.current!;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    el.replaceChildren();
    setState("loading");

    (async () => {
      try {
        // Fetched by the page (not pdf.js) so the browser's cache is used and the file isn't downloaded twice.
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        task = getDocument({ data: new Uint8Array(await res.arrayBuffer()) });
        const doc = await task.promise;
        if (cancelled) return;
        setPageCount(doc.numPages);
        const dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const fit = (el.clientWidth || 600) / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale: fit * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "mb-3 block w-full rounded-md border border-line bg-white shadow-sm";
          canvas.setAttribute("aria-label", `Page ${n}`);
          el.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          if (n === 1 && !cancelled) setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  return (
    <div>
      {state === "loading" && <Loading label="Loading PDF…" />}
      {state === "error" && (
        <p className="py-10 text-center text-sm text-urgent-ink">
          This PDF couldn't be shown here. Use Download or Open to view it.
        </p>
      )}
      <div ref={pagesRef} />
      {pageCount > MAX_PAGES && (
        <p className="py-3 text-center text-sm text-slate-500">
          Showing the first {MAX_PAGES} of {pageCount} pages. Open the file to see the rest.
        </p>
      )}
    </div>
  );
}
