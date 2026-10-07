// Import / Export (user request 2026-10-07; side rail on wider screens, profile side panel on phones). A master
// backup (one JSON file with WorkDesk's own records; importing it only adds what is missing, user's choice) and
// CSV import/export for the file register, employees, tasks and reminders, each with a sample CSV. A CSV row that
// matches an existing entry updates it, others are added (user's choice); the app shows what will happen first.
// Excel files (.xlsx) are read too. Only WorkDesk's database changes; Gmail is never touched.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Check, DatabaseBackup, Download, FolderOpen, ListChecks, Upload, UsersRound } from "lucide-react";
import { api } from "../api";
import { saveFile } from "../saveFile";
import {
  BACKUP_CHUNK,
  BACKUP_TABLES,
  BACKUP_TABLE_NAMES,
  CSV_MATCH,
  CSV_TITLES,
  IMPORT_CHUNK,
  MAX_IMPORT_ROWS,
  sampleCsv,
  type Backup,
  type BackupTable,
  type CsvKind,
  type ImportResult,
} from "../../shared/transfer";
import { Button, Card, ErrorNote, Modal, PageHeader, Spinner, cx } from "../components/ui";

const today = () => new Date().toLocaleDateString("en-CA");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// A file ready to save that iPhone wouldn't share without a fresh tap.
type Ready = { blob: Blob; name: string } | null;

export function ImportExportPage() {
  return (
    <>
      <PageHeader title="Import / Export" subtitle="Download a backup of everything, or move lists in and out as CSV files (Excel, Google Sheets)." />
      <div className="space-y-4">
        <BackupCard />
        <CsvCard kind="files" icon={<FolderOpen size={18} />} text="Physical files and e-files with their numbers." />
        <CsvCard kind="employees" icon={<UsersRound size={18} />} text="Permanent and temporary employees with all their details. Designations and types named in the file are added if they are new." />
        <CsvCard kind="tasks" icon={<ListChecks size={18} />} text="Every task, open and completed. Import adds or updates tasks made by hand; tasks from emails can be updated, and a reminder's tasks are left as they are." />
        <CsvCard kind="reminders" icon={<CalendarClock size={18} />} text="Reminders with their repeat, time, links and who they are for." />
        <p className="text-footnote text-slate-500">
          Importing only changes WorkDesk; your emails in Gmail are never touched. Every import is recorded in History.
        </p>
      </div>
    </>
  );
}

function SaveReady({ ready, onDone }: { ready: Ready; onDone: () => void }) {
  if (!ready) return null;
  return (
    <Button size="sm" variant="primary" onClick={() => void saveFile(ready.blob, ready.name).then(onDone)} className="mt-3">
      <Download size={15} /> Save {ready.name}
    </Button>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <span className="text-brand-700">{icon}</span> {title}
      </h2>
      {children}
    </Card>
  );
}

// --- CSV lists ---

function CsvCard({ kind, icon, text }: { kind: CsvKind; icon: ReactNode; text: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState<Ready>(null);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const title = CSV_TITLES[kind];
  const name = `workdesk-${kind}-${today()}.csv`;

  const exportCsv = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transfer/${kind}/csv`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Export failed (${res.status})`);
      const blob = new Blob([await res.arrayBuffer()], { type: "text/csv" });
      if ((await saveFile(blob, name)) === "tap") setReady({ blob, name });
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  // Made in the app, so the share sheet opens straight from the tap.
  const sample = () => void saveFile(new Blob([sampleCsv(kind)], { type: "text/csv" }), `workdesk-${kind}-sample.csv`);

  return (
    <Section icon={icon} title={title}>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={exportCsv} disabled={busy}>
          {busy ? <Spinner size={15} /> : <Download size={15} />} Export CSV
        </Button>
        <Button onClick={() => input.current?.click()}>
          <Upload size={15} /> Import CSV…
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,.xls,.ods,text/csv"
          className="hidden"
          aria-label={`Choose a ${title} file to import`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setFile(f);
          }}
        />
      </div>
      <SaveReady ready={ready} onDone={() => setReady(null)} />
      <ErrorNote error={error} />
      {/* Helper text with the sample file (user request 2026-10-07). */}
      <p className="mt-3 text-footnote text-slate-500">
        <button type="button" onClick={sample} className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
          Download sample CSV
        </button>{" "}
        to fill in for a bulk upload. Rows with {CSV_MATCH[kind]} update that entry; the rest are added. In Excel, save as “CSV UTF-8” (or keep the .xlsx) so Malayalam stays readable.
      </p>
      <Modal open={file !== null} onClose={() => setFile(null)} title={`Import ${title.toLowerCase()}`}>
        {file && <CsvImport key={file.name + file.lastModified} kind={kind} file={file} onClose={() => setFile(null)} />}
      </Modal>
    </Section>
  );
}

// Reads a CSV or Excel file into a header row and rows of text (SheetJS, loaded only when needed). Excel date
// cells become YYYY-MM-DD (and time-only cells HH:MM) from their value, not their shown text, which may be
// month-first.
async function readTable(file: File): Promise<{ headers: string[]; rows: string[][]; firstLine: number }> {
  const { read, utils, SSF } = await import("@e965/xlsx");
  const csv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  const wb = csv ? read((await file.text()).replace(/^\uFEFF/, ""), { type: "string", raw: true }) : read(await file.arrayBuffer(), { type: "array", cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws?.["!ref"]) throw new Error("The file is empty");
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = (cell: { t: string; v?: unknown; w?: string; z?: string } | undefined): string => {
    if (!cell || cell.v == null) return "";
    if (cell.t === "d" && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
    if (cell.t === "n" && cell.z && SSF.is_date(cell.z)) {
      const d = SSF.parse_date_code(cell.v as number) as { y: number; m: number; d: number; H: number; M: number };
      return (cell.v as number) < 1 ? `${pad(d.H)}:${pad(d.M)}` : `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    }
    if (cell.t === "n") return String(cell.v);
    return cell.w ?? String(cell.v);
  };
  const range = utils.decode_range(ws["!ref"]);
  const all: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) row.push(text(ws[utils.encode_cell({ r, c })]));
    all.push(row);
  }
  const h = all.findIndex((r) => r.some((c) => c.trim()));
  if (h < 0) throw new Error("The file is empty");
  return { headers: all[h]!, rows: all.slice(h + 1), firstLine: range.s.r + h + 2 };
}

const chunks = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

function CsvImport({ kind, file, onClose }: { kind: CsvKind; file: File; onClose: () => void }) {
  const qc = useQueryClient();
  const [table, setTable] = useState<Awaited<ReturnType<typeof readTable>> | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [final, setFinal] = useState<ImportResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const title = CSV_TITLES[kind].toLowerCase();

  // Read the file and ask the server what would happen.
  useEffect(() => {
    void (async () => {
      try {
        const t = await readTable(file);
        const rows = t.rows.filter((r) => r.some((c) => c.trim()));
        if (rows.length > MAX_IMPORT_ROWS) throw new Error(`The file has ${rows.length} rows; import up to ${MAX_IMPORT_ROWS} at a time.`);
        setTable(t);
        setPreview(await api<ImportResult>(`/transfer/${kind}/import`, { method: "POST", body: { headers: t.headers, rows: t.rows, firstLine: t.firstLine, dryRun: true } }));
      } catch (e) {
        setError(e as Error);
      }
    })();
  }, [file, kind]);

  const run = async () => {
    if (!table) return;
    const total: ImportResult = { added: 0, updated: 0, skipped: 0, problems: [], created: [], unknownColumns: preview?.unknownColumns ?? [] };
    const parts = chunks(table.rows, IMPORT_CHUNK);
    setProgress({ done: 0, total: table.rows.length });
    try {
      for (const [i, rows] of parts.entries()) {
        const r = await api<ImportResult>(`/transfer/${kind}/import`, { method: "POST", body: { headers: table.headers, rows, firstLine: table.firstLine + i * IMPORT_CHUNK } });
        total.added += r.added;
        total.updated += r.updated;
        total.skipped += r.skipped;
        total.problems.push(...r.problems.filter((p) => p.row !== 1 || i === 0));
        total.created.push(...r.created);
        setProgress({ done: Math.min(table.rows.length, (i + 1) * IMPORT_CHUNK), total: table.rows.length });
      }
      setFinal(total);
    } catch (e) {
      setError(e as Error);
      setFinal(total);
    } finally {
      void qc.invalidateQueries();
    }
  };

  if (final)
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-ink">
          <Check size={18} className="mt-px shrink-0 text-low-ink" />
          <span>
            {plural(final.added, "row")} added and {plural(final.updated, "row")} updated in the {title}.
          </span>
        </p>
        <ErrorNote error={error} />
        <ResultDetails r={final} />
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );

  if (progress)
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-slate-600">
          Importing… {progress.done} of {progress.total} rows
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-sm break-all text-slate-600">{file.name}</p>
      {error ? (
        <ErrorNote error={error} />
      ) : !preview ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner size={16} /> Reading the file…
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2">
            <Stat n={preview.added} label="new" tone="text-low-ink" />
            <Stat n={preview.updated} label="to update" tone="text-brand-700" />
            <Stat n={preview.problems.length} label="can't be imported" tone={preview.problems.length ? "text-urgent-ink" : "text-slate-500"} />
          </ul>
          <ResultDetails r={preview} preview />
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!preview || preview.added + preview.updated === 0} onClick={run}>
          <Upload size={15} /> Import {preview ? plural(preview.added + preview.updated, "row") : ""}
        </Button>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <li className="rounded-lg border border-line px-2 py-1.5 text-center">
      <span className={cx("block text-title3 font-semibold tabular-nums", tone)}>{n}</span>
      <span className="block text-footnote leading-tight text-slate-600">{label}</span>
    </li>
  );
}

function ResultDetails({ r, preview }: { r: ImportResult; preview?: boolean }) {
  const shown = r.problems.slice(0, 50);
  return (
    <>
      {r.created.length > 0 && (
        <p className="text-footnote text-slate-600">
          {preview ? "Will also add" : "Also added"}: {r.created.join(", ")}.
        </p>
      )}
      {r.skipped > 0 && <p className="text-footnote text-slate-600">{plural(r.skipped, "reminder task")} left as {r.skipped === 1 ? "it is" : "they are"} (they change with their reminder).</p>}
      {r.unknownColumns.length > 0 && <p className="text-footnote text-slate-600">Columns not used: {r.unknownColumns.join(", ")}.</p>}
      {shown.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-footnote font-medium text-urgent-ink">
            <AlertTriangle size={14} /> {preview ? "These rows will be left out" : "Rows not imported"}
          </p>
          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-line p-2 text-footnote text-slate-700">
            {shown.map((p, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <span className="font-medium">Row {p.row}:</span> {p.message}
              </li>
            ))}
            {r.problems.length > shown.length && <li className="text-slate-500">…and {r.problems.length - shown.length} more</li>}
          </ul>
        </div>
      )}
    </>
  );
}

// --- Master backup ---

function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState<Ready>(null);
  const [backup, setBackup] = useState<{ name: string; data: Backup } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<Backup>("/transfer/backup");
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const name = `workdesk-backup-${today()}.json`;
      if ((await saveFile(blob, name)) === "tap") setReady({ blob, name });
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (f: File) => {
    setError(null);
    try {
      const data = JSON.parse(await f.text()) as Backup;
      if (data?.app !== "WorkDesk" || typeof data.tables !== "object") throw new Error("This is not a WorkDesk backup file.");
      setBackup({ name: f.name, data });
    } catch (e) {
      setError(e instanceof SyntaxError ? new Error("This is not a WorkDesk backup file.") : (e as Error));
    }
  };

  return (
    <Section icon={<DatabaseBackup size={18} />} title="Master backup">
      <p className="mt-1 text-sm text-slate-600">
        One file with everything in WorkDesk: tasks, reminders, employees, designations, the file register, hidden text, hidden senders and History. Emails stay in Gmail and come back with the sync.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={download} disabled={busy}>
          {busy ? <Spinner size={15} /> : <Download size={15} />} Download backup
        </Button>
        <Button onClick={() => input.current?.click()}>
          <Upload size={15} /> Import backup…
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Choose a backup file to import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pick(f);
          }}
        />
      </div>
      <SaveReady ready={ready} onDone={() => setReady(null)} />
      <ErrorNote error={error} />
      <p className="mt-3 text-footnote text-slate-500">Importing a backup only adds what isn't in WorkDesk yet; nothing is deleted or changed, so it is safe to import the same file twice.</p>
      <Modal open={backup !== null} onClose={() => setBackup(null)} title="Import backup">
        {backup && <BackupImport key={backup.name} backup={backup} onClose={() => setBackup(null)} />}
      </Modal>
    </Section>
  );
}

function BackupImport({ backup, onClose }: { backup: { name: string; data: Backup }; onClose: () => void }) {
  const qc = useQueryClient();
  const tables = BACKUP_TABLES.filter((t) => (backup.data.tables[t]?.length ?? 0) > 0);
  const [progress, setProgress] = useState<{ table: BackupTable; done: number; total: number } | null>(null);
  const [added, setAdded] = useState<Partial<Record<BackupTable, number>> | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const when = new Date(backup.data.exportedAt);

  const run = async () => {
    const got: Partial<Record<BackupTable, number>> = {};
    try {
      for (const t of tables) {
        const rows = backup.data.tables[t]!;
        for (const [i, part] of chunks(rows, BACKUP_CHUNK).entries()) {
          setProgress({ table: t, done: i * BACKUP_CHUNK, total: rows.length });
          const r = await api<{ added: number }>("/transfer/backup", { method: "POST", body: { table: t, rows: part } });
          got[t] = (got[t] ?? 0) + r.added;
        }
      }
      await api("/transfer/backup/done", { method: "POST", body: { added: got } });
    } catch (e) {
      setError(e as Error);
    } finally {
      setAdded(got);
      setProgress(null);
      void qc.invalidateQueries();
    }
  };

  if (added) {
    const total = Object.values(added).reduce((a, b) => a + (b ?? 0), 0);
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-ink">
          <Check size={18} className="mt-px shrink-0 text-low-ink" />
          {total ? `${plural(total, "item")} added.` : "Nothing to add: everything in the backup is already in WorkDesk."}
        </p>
        <ErrorNote error={error} />
        {total > 0 && (
          <ul className="space-y-1 text-sm text-slate-600">
            {tables.filter((t) => added[t]).map((t) => (
              <li key={t}>
                {BACKUP_TABLE_NAMES[t]}: {added[t]}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">
        {backup.name}
        {!Number.isNaN(when.getTime()) && ` · made ${when.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}`}
      </p>
      <ul className="divide-y divide-line rounded-lg border border-line text-sm">
        {tables.map((t) => (
          <li key={t} className={cx("flex items-center justify-between gap-3 px-3 py-1.5", progress?.table === t && "bg-tint")}>
            <span className="min-w-0 text-ink">{BACKUP_TABLE_NAMES[t]}</span>
            <span className="shrink-0 text-slate-500 tabular-nums">
              {progress?.table === t && <Spinner size={13} className="mr-1.5 inline" />}
              {backup.data.tables[t]!.length}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-footnote text-slate-500">Items already in WorkDesk are skipped; only missing ones are added. Tasks from emails of another Gmail account come in as tasks without their email.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={!!progress}>
          Cancel
        </Button>
        <Button variant="primary" onClick={run} disabled={!!progress || tables.length === 0}>
          {progress ? <Spinner size={15} /> : <Upload size={15} />} {progress ? "Importing…" : "Import"}
        </Button>
      </div>
    </div>
  );
}
