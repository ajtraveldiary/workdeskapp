// PowerPoint attachments (.pptx) shown as each slide's text (user request 2026-10-11): titles and bullet points in
// slide order, no layout or pictures. The file is a zip of XML; it is unzipped with fflate and read with the
// browser's XML parser, and only text is shown (nothing from the file runs). Loaded only when a .pptx is opened.
import { useEffect, useState } from "react";
import { unzipSync } from "fflate";
import { Loading } from "./ui";

type Slide = { title: string; lines: { text: string; level: number }[] };

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

function readSlide(xml: string): Slide {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  let title = "";
  const lines: Slide["lines"] = [];
  for (const shape of Array.from(doc.getElementsByTagNameNS(NS_P, "sp"))) {
    const ph = shape.getElementsByTagNameNS(NS_P, "ph")[0];
    const isTitle = ph && ["title", "ctrTitle"].includes(ph.getAttribute("type") ?? "");
    for (const p of Array.from(shape.getElementsByTagNameNS(NS_A, "p"))) {
      const text = Array.from(p.getElementsByTagNameNS(NS_A, "t"))
        .map((t) => t.textContent ?? "")
        .join("")
        .trim();
      if (!text) continue;
      if (isTitle && !title) title = text;
      else lines.push({ text, level: Number(p.getElementsByTagNameNS(NS_A, "pPr")[0]?.getAttribute("lvl") ?? 0) });
    }
  }
  // Text in tables on the slide.
  for (const cell of Array.from(doc.getElementsByTagNameNS(NS_A, "tc"))) {
    const text = Array.from(cell.getElementsByTagNameNS(NS_A, "t"))
      .map((t) => t.textContent ?? "")
      .join(" ")
      .trim();
    if (text) lines.push({ text, level: 0 });
  }
  return { title, lines };
}

export default function SlidesPreview({ url }: { url: string }) {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSlides(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const files = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
        const dec = new TextDecoder();
        const list = Object.keys(files)
          .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
          .map((name) => readSlide(dec.decode(files[name])));
        if (!cancelled) setSlides(list);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return <p className="py-12 text-center text-sm text-slate-500">This presentation couldn't be read. Download it to open.</p>;
  if (slides === null) return <Loading label="Loading slides…" />;
  if (slides.length === 0) return <p className="py-12 text-center text-sm text-slate-500">No slides found. Download it to open.</p>;
  return (
    <div className="space-y-3">
      <p className="text-footnote text-slate-500">Text of each slide (pictures and layout aren't shown; Download for the full file).</p>
      {slides.map((s, i) => (
        <section key={i} className="rounded-lg border border-line bg-white p-3" aria-label={`Slide ${i + 1}`}>
          <p className="text-caption font-medium text-slate-400">Slide {i + 1}</p>
          {s.title && <h4 className="mt-0.5 font-semibold text-ink [overflow-wrap:anywhere]">{s.title}</h4>}
          {s.lines.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {s.lines.map((l, j) => (
                <li key={j} className="[overflow-wrap:anywhere]" style={{ paddingLeft: `${l.level * 1}rem` }}>
                  {l.text}
                </li>
              ))}
            </ul>
          ) : (
            !s.title && <p className="mt-0.5 text-sm text-slate-400">(No text on this slide)</p>
          )}
        </section>
      ))}
    </div>
  );
}
