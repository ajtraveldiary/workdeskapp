// Spreadsheet attachments (Excel .xlsx/.xls, OpenOffice .ods, .csv) shown as a table inside WorkDesk (user
// request 2026-10-06). Read in the browser with SheetJS; loaded on demand, like pdf.js for PDFs.
import { useEffect, useMemo, useState } from "react";
import { read, utils, type WorkBook } from "@e965/xlsx";
import { Loading, cx } from "./ui";

const MAX_ROWS = 500;
const MAX_COLS = 50;

export default function SheetPreview({ url }: { url: string }) {
  const [book, setBook] = useState<WorkBook | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setFailed(false);
    setSheet(0);
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const wb = read(new Uint8Array(await res.arrayBuffer()), { type: "array", sheetRows: MAX_ROWS + 1, cellHTML: false, cellStyles: false, dateNF: "dd/mm/yyyy" });
        if (!cancelled) setBook(wb);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return <p className="py-12 text-center text-sm text-slate-500">This spreadsheet couldn't be shown. Download it to open.</p>;
  if (!book) return <Loading label="Loading spreadsheet…" />;
  return (
    <div>
      {book.SheetNames.length > 1 && (
        <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Sheets">
          {book.SheetNames.map((name, i) => (
            <button
              key={name}
              role="tab"
              aria-selected={i === sheet}
              onClick={() => setSheet(i)}
              className={cx(
                "max-w-48 shrink-0 truncate rounded-full border px-3 py-1 text-xs font-medium active:scale-[0.97]",
                i === sheet ? "border-brand-500 bg-tint text-brand-700" : "border-line bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <SheetTable book={book} index={sheet} />
    </div>
  );
}

function SheetTable({ book, index }: { book: WorkBook; index: number }) {
  const ws = book.Sheets[book.SheetNames[index]!]!;
  const table = useMemo(() => {
    // Formatted values as Excel shows them (money, percentages); plain dates day first, as in India.
    const rows = utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", blankrows: true, dateNF: "dd/mm/yyyy" });
    const range = ws["!ref"] ? utils.decode_range(ws["!ref"]) : null;
    const startRow = range?.s.r ?? 0;
    const startCol = range?.s.c ?? 0;
    let cols = 0;
    for (const r of rows) cols = Math.max(cols, r.length);
    const shownCols = Math.min(cols, MAX_COLS);
    // Merged cells (common in office report headers): the first cell spans, the others are left out.
    const span = new Map<string, { rows: number; cols: number }>();
    const covered = new Set<string>();
    for (const m of ws["!merges"] ?? []) {
      const r0 = m.s.r - startRow;
      const c0 = m.s.c - startCol;
      span.set(`${r0}:${c0}`, { rows: m.e.r - m.s.r + 1, cols: m.e.c - m.s.c + 1 });
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r - startRow}:${c - startCol}`);
    }
    return { rows: rows.slice(0, MAX_ROWS), more: rows.length > MAX_ROWS || (range ? range.e.r - range.s.r + 1 > MAX_ROWS : false), cols: shownCols, moreCols: cols > MAX_COLS, startRow, startCol, span, covered };
  }, [ws]);

  if (table.rows.length === 0) return <p className="py-12 text-center text-sm text-slate-500">This sheet is empty.</p>;
  return (
    <>
      <div className="scroll-thin max-h-[75vh] overflow-auto rounded-md border border-line bg-white">
        <table className="border-collapse text-xs text-ink">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 border-r border-b border-line bg-slate-100" />
              {Array.from({ length: table.cols }, (_, c) => (
                <th key={c} className="sticky top-0 z-10 border-r border-b border-line bg-slate-100 px-2 py-1 font-medium text-slate-500">
                  {utils.encode_col(table.startCol + c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                <th className="sticky left-0 z-10 border-r border-b border-line bg-slate-100 px-1.5 py-1 text-right font-medium text-slate-500 tabular-nums">{table.startRow + r + 1}</th>
                {Array.from({ length: table.cols }, (_, c) => {
                  const k = `${r}:${c}`;
                  if (table.covered.has(k)) return null;
                  const s = table.span.get(k);
                  return (
                    <td key={c} rowSpan={s?.rows} colSpan={s?.cols} className="max-w-80 min-w-16 border-r border-b border-line px-2 py-1 align-top break-words whitespace-pre-wrap">
                      {row[c] ?? ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(table.more || table.moreCols) && (
        <p className="mt-2 text-center text-xs text-slate-500">
          Showing the first {table.more ? `${MAX_ROWS} rows` : ""}
          {table.more && table.moreCols ? " and " : ""}
          {table.moreCols ? `${MAX_COLS} columns` : ""}. Download the file to see all of it.
        </p>
      )}
    </>
  );
}
