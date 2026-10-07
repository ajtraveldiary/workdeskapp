// File register (user request 2026-10-07): the office's files in one list. An old physical file has only its name
// (physical files have no number, user 2026-10-07) and, once the e-file is made, its e-file number; a new e-file
// has its subject and number. A physical file without an e-file number shows "E-file not yet created". Next to
// Staff (side rail / profile menu).
import { useState, type FormEvent } from "react";
import { Check, Copy, FileText, FolderClosed, FolderOpen, Plus, Search, Trash2 } from "lucide-react";
import type { OfficeFile } from "../../shared/types";
import type { OfficeFileInput } from "../../shared/schemas";
import { useOfficeFileActions, useOfficeFiles } from "../api";
import { RefreshButton } from "../components/RefreshButton";
import { Badge, Button, Card, ErrorNote, Fab, Field, Modal, PageHeader, Segmented, SkeletonList, cx, inputClass } from "../components/ui";

type Filter = "all" | "pending" | "efiles";

export function FilesPage() {
  const { data, error } = useOfficeFiles();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [form, setForm] = useState<{ file: OfficeFile | null } | null>(null);
  const files = data?.files ?? [];
  const pending = files.filter((f) => !f.efileNumber);
  const query = q.trim().toLowerCase();
  const shown = files
    .filter((f) => (filter === "pending" ? !f.efileNumber : filter === "efiles" ? !!f.efileNumber : true))
    .filter((f) => !query || [f.subject, f.efileNumber, f.notes].some((x) => x.toLowerCase().includes(query)));
  const add = () => setForm({ file: null });

  return (
    <>
      <PageHeader
        title="File register"
        subtitle="Old physical files with their e-file numbers, and new e-files. A file without an e-file number shows as not yet created."
        actions={
          <>
            <RefreshButton keys={[["files"]]} label="Refresh file register" />
            <Button variant="primary" onClick={add} className="max-sm:hidden">
              <Plus size={17} /> Add file
            </Button>
          </>
        }
      />
      <Fab label="Add file" onClick={add} />
      {error ? (
        <p className="text-urgent-ink">{error.message}</p>
      ) : !data ? (
        <SkeletonList rows={6} />
      ) : files.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-info text-white">
            <FolderOpen size={22} />
          </span>
          <p className="mt-3 font-medium text-ink">No files yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Add each file of the section: an old physical file with its e-file number (or none yet), or a new e-file with its subject and number.
          </p>
          <Button variant="primary" className="mt-4" onClick={add}>
            <Plus size={16} /> Add file
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject or file number" aria-label="Search files" className={cx(inputClass, "pl-9")} />
          </label>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            oneRow
            options={[
              { value: "all", label: "All", count: files.length },
              { value: "pending", label: "E-file not created", count: pending.length, tone: pending.length ? "high" : undefined },
              { value: "efiles", label: "E-files", count: files.length - pending.length },
            ]}
          />
          <Card className="overflow-hidden">
            {shown.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">{query ? `No file matches “${q.trim()}”.` : "Nothing here."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {shown.map((f) => (
                  <FileRow key={f.id} file={f} onOpen={() => setForm({ file: f })} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.file ? "Edit file" : "Add file"}>
        {form && <FileForm key={form.file?.id ?? "new"} file={form.file} onDone={() => setForm(null)} />}
      </Modal>
    </>
  );
}

function FileRow({ file: f, onOpen }: { file: OfficeFile; onOpen: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(f.efileNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  const Icon = f.physical ? FolderClosed : FileText;
  return (
    <li className="row-click flex items-start gap-3 px-4 py-2.5 has-[:is(button,a):hover]:bg-slate-50/80 sm:px-5">
      <Icon size={18} className={cx("mt-0.5 shrink-0", f.physical ? "text-medium-ink" : "text-brand-700")} aria-hidden />
      <button onClick={onOpen} className="row-link group/title min-w-0 flex-1 text-left">
        <span className="line-clamp-2 text-subhead font-medium text-ink [overflow-wrap:anywhere] group-hover/title:text-brand-700">{f.subject}</span>
        <span className="block text-footnote text-slate-500 [overflow-wrap:anywhere]">
          {f.physical ? "Physical file" : "E-file"}
          {f.notes && <span className="text-slate-400"> · {f.notes.split("\n")[0]}</span>}
        </span>
      </button>
      {f.efileNumber ? (
        // Tap the number to copy it (for searching in e-office).
        <button onClick={copy} title="Copy e-file number" aria-label={`Copy e-file number ${f.efileNumber}`} className="mt-px inline-flex shrink-0 items-center gap-1 rounded-md bg-tint px-1.5 py-0.5 text-footnote font-medium text-brand-800 tabular-nums active:scale-95">
          {copied ? <Check size={13} /> : <Copy size={12} className="opacity-60" />}
          {f.efileNumber}
        </button>
      ) : (
        <span className="mt-px shrink-0">
          <Badge tone="high">E-file not yet created</Badge>
        </span>
      )}
    </li>
  );
}

function FileForm({ file, onDone }: { file: OfficeFile | null; onDone: () => void }) {
  const [v, setV] = useState<Required<OfficeFileInput>>(
    file ? { subject: file.subject, physical: file.physical, efileNumber: file.efileNumber, notes: file.notes } : { subject: "", physical: true, efileNumber: "", notes: "" },
  );
  const set = <K extends keyof OfficeFileInput>(k: K, value: Required<OfficeFileInput>[K]) => setV((s) => ({ ...s, [k]: value }));
  const { add, save, remove } = useOfficeFileActions();
  const busy = add.isPending || save.isPending || remove.isPending;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (file) await save.mutateAsync({ id: file.id, input: v });
      else await add.mutateAsync(v);
      onDone();
    } catch {
      // shown under the form (e.g. an e-file number already in the register)
    }
  };
  const del = () => {
    if (!file || !confirm(`Remove "${file.subject}" from the file register?`)) return;
    remove.mutate(file.id, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={v.physical ? "File name / subject" : "E-file subject"}>
        <textarea
          className={cx(inputClass, "h-auto resize-none py-2")}
          rows={2}
          value={v.subject}
          onChange={(e) => set("subject", e.target.value.replace(/\s*\n\s*/g, " "))}
          required
          autoFocus={!file}
          maxLength={200}
          placeholder="e.g. Professional Tax, JPHN Establishment"
        />
      </Field>
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Kind</span>
        {/* Its own buttons (type="button"), so choosing a kind never submits the form. */}
        <div role="radiogroup" aria-label="Kind" className="inline-flex gap-1.5">
          {([
            [true, "Physical file", FolderClosed],
            [false, "New e-file", FileText],
          ] as const).map(([physical, label, Icon]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={v.physical === physical}
              onClick={() => set("physical", physical)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800"
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>
      <Field label="E-file number">
        <input className={inputClass} value={v.efileNumber} onChange={(e) => set("efileNumber", e.target.value)} maxLength={50} placeholder={v.physical ? "e.g. 255/2026 (empty = not yet created)" : "e.g. 340/2026"} />
      </Field>
      <Field label="Notes (optional)">
        <textarea className={cx(inputClass, "h-auto py-2")} rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} placeholder="e.g. kept in rack 3, older volumes" />
      </Field>
      <ErrorNote error={add.error ?? save.error ?? remove.error} />
      <div className="flex flex-wrap items-center gap-2">
        {file && (
          <Button type="button" variant="danger" onClick={del} disabled={busy} aria-label="Remove file" title="Remove from the register">
            <Trash2 size={15} />
          </Button>
        )}
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          <Check size={16} /> {file ? "Save" : "Add file"}
        </Button>
      </div>
    </form>
  );
}

