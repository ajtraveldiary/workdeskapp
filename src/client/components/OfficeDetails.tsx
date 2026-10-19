// Settings › General › Office details (user request 2026-10-19): letterhead, seat, signature block, file number
// pattern, usual recipients and office codes. Assistants use them to draft complete official letters, leaving
// [blanks] only for what is really unknown. Saved with Save (the whole form); each save is in History.
import { useEffect, useState, type FormEvent } from "react";
import { Building2, Plus, X } from "lucide-react";
import type { OfficeProfile } from "../../shared/schemas";
import { useOfficeProfile, useSaveOfficeProfile } from "../api";
import { Button, Card, ErrorNote, Field, Loading, Segmented, cx, inputClass } from "./ui";

const areaClass = cx(inputClass, "h-auto! min-h-20 py-2 leading-snug");

export function OfficeDetails() {
  const { data, error } = useOfficeProfile();
  const save = useSaveOfficeProfile();
  const [form, setForm] = useState<OfficeProfile | null>(null);
  const [saved, setSaved] = useState(false);
  // Start from what is saved; a later refresh doesn't overwrite what is being typed.
  useEffect(() => {
    if (data && !form) setForm(data.profile);
  }, [data, form]);
  const dirty = !!form && !!data && JSON.stringify(form) !== JSON.stringify(data.profile);
  const set = <K extends keyof OfficeProfile>(k: K, v: OfficeProfile[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form) save.mutate(form, { onSuccess: () => setSaved(true) });
  };

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <Building2 size={18} className="text-brand-700" /> Office details
      </h2>
      <p className="mt-1 text-sm text-slate-600">Used by ChatGPT or Gemini to draft complete official letters: the letterhead, your seat and signature, file numbers and who letters usually go to.</p>
      <ErrorNote error={error} />
      {!form ? (
        !error && <Loading className="py-4" />
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Office name">
              <input className={inputClass} value={form.officeName} onChange={(e) => set("officeName", e.target.value)} placeholder="Community Health Centre, …" />
            </Field>
            <Field label="Your seat / section">
              <input className={inputClass} value={form.seat} onChange={(e) => set("seat", e.target.value)} placeholder="B1, Establishment" />
            </Field>
          </div>
          <Field label="Office address">
            <textarea className={areaClass} value={form.address} onChange={(e) => set("address", e.target.value)} rows={3} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <input className={inputClass} value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Email">
              <input className={inputClass} value={form.email} onChange={(e) => set("email", e.target.value)} type="email" />
            </Field>
          </div>
          <Field label="Signature block (as under your letters)">
            <textarea className={areaClass} value={form.signature} onChange={(e) => set("signature", e.target.value)} rows={3} placeholder={"Medical Officer in charge\nCommunity Health Centre, …"} />
          </Field>
          <Field label="File number pattern">
            <input className={inputClass} value={form.fileNumberPattern} onChange={(e) => set("fileNumberPattern", e.target.value)} placeholder="B1-{no}/{year}/CHC" />
          </Field>
          <p className="-mt-3 text-footnote text-slate-500">Write {"{no}"} where the file's own number goes and {"{year}"} for the year.</p>

          <PairList
            title="Usual recipients"
            hint="Who letters often go to, with the address to print."
            items={form.recipients.map((r) => [r.who, r.address])}
            labels={["Who", "Address"]}
            placeholders={["District Medical Officer (Health), …", "Address"]}
            multiline
            addLabel="Add recipient"
            onChange={(rows) => set("recipients", rows.map(([who, address]) => ({ who, address })))}
          />
          <PairList
            title="Office codes"
            hint="DDO code, SPARK office code, HMIS facility ID and the like."
            items={form.codes.map((c) => [c.label, c.value])}
            labels={["Name", "Code"]}
            placeholders={["DDO code", ""]}
            addLabel="Add code"
            onChange={(rows) => set("codes", rows.map(([label, value]) => ({ label, value })))}
          />

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Letters in</span>
            <Segmented<OfficeProfile["letterLanguage"]>
              value={form.letterLanguage}
              onChange={(v) => set("letterLanguage", v)}
              oneRow
              options={[
                { value: "English", label: "English" },
                { value: "Malayalam", label: "Malayalam" },
              ]}
            />
          </div>

          <ErrorNote error={save.error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
              Save office details
            </Button>
            {saved && !dirty && <span className="text-footnote text-low-ink">Saved</span>}
          </div>
        </form>
      )}
    </Card>
  );
}

// A short editable list of two-part rows (recipients, codes) with ✕ to remove one and a button to add one.
function PairList({
  title,
  hint,
  items,
  labels,
  placeholders,
  multiline,
  addLabel,
  onChange,
}: {
  title: string;
  hint: string;
  items: [string, string][];
  labels: [string, string];
  placeholders: [string, string];
  multiline?: boolean;
  addLabel: string;
  onChange: (rows: [string, string][]) => void;
}) {
  const update = (i: number, j: 0 | 1, v: string) => onChange(items.map((row, k) => (k === i ? ((j === 0 ? [v, row[1]] : [row[0], v]) as [string, string]) : row)));
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">{title}</legend>
      <p className="mb-2 text-footnote text-slate-500">{hint}</p>
      {items.length > 0 && (
        <ul className="mb-2 space-y-2">
          {items.map(([a, b], i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg border border-line p-2">
              <div className={cx("grid min-w-0 flex-1 gap-2", !multiline && "sm:grid-cols-2")}>
                <input className={inputClass} aria-label={labels[0]} value={a} placeholder={placeholders[0] || labels[0]} onChange={(e) => update(i, 0, e.target.value)} />
                {multiline ? (
                  <textarea className={cx(areaClass, "min-h-16")} aria-label={labels[1]} value={b} placeholder={placeholders[1] || labels[1]} rows={2} onChange={(e) => update(i, 1, e.target.value)} />
                ) : (
                  <input className={inputClass} aria-label={labels[1]} value={b} placeholder={placeholders[1] || labels[1]} onChange={(e) => update(i, 1, e.target.value)} />
                )}
              </div>
              <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label={`Remove ${a || "row"}`} className="mt-2 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-urgent-ink active:scale-90">
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...items, ["", ""]])} disabled={items.length >= 30}>
        <Plus size={14} /> {addLabel}
      </Button>
    </fieldset>
  );
}
