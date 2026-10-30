// Settings › Leave (user request 2026-10-30, docs/LEAVE_PLAN.md): the kinds of leave the office keeps (earned leave,
// half pay leave, commuted leave…, never casual or compensation leave) with their rules, "Credit now" for a year's
// credit to every permanent employee, and which designations are gazetted posts.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarOff, Check, ListPlus, Pencil, Plus, Trash2, BadgeCheck, CalendarPlus } from "lucide-react";
import type { LeaveType } from "../../shared/types";
import type { LeaveTypeInput } from "../../shared/schemas";
import { USUAL_LEAVE_TYPES, daysWord, formatDays, leaveShort } from "../../shared/leave";
import { useLeaveActions, useLeaveTypes, useMe, useStaff, useStaffActions } from "../api";
import { Button, Card, ErrorNote, Field, Loading, Modal, cx, inputClass } from "./ui";
import { SortableList } from "./SortableList";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// What a type does, in a few words: "Own balance · 20 days a year · up to 300 days".
function ruleText(t: LeaveType, types: LeaveType[]) {
  const parts: string[] = [];
  if (t.hasAccount) {
    parts.push("Own balance");
    if (t.fromDuty) parts.push("1/11 of the days on duty each year");
    else if (t.yearlyDays) parts.push(`${daysWord(t.yearlyDays)} a year`);
    if (t.creditsFrom) parts.push("credited automatically");
    if (t.maxBalance != null) parts.push(`up to ${daysWord(t.maxBalance)}`);
  } else if (t.drawsOnId) {
    const from = types.find((x) => x.id === t.drawsOnId);
    parts.push(`Takes ${t.perDay === 1 ? "" : `${formatDays(t.perDay)} days of `}${from ? leaveShort(from) : "another leave"}${t.perDay === 1 ? "" : " a day"}`);
    if (t.mayGoNegative) parts.push("may go below zero");
  } else parts.push("No balance");
  if (t.serviceLimit != null) parts.push(`${daysWord(t.serviceLimit)} in the whole service`);
  if (t.medical) parts.push("medical certificate");
  if (t.delaysIncrement) parts.push("not counted for increment");
  return parts.join(" · ");
}

export function LeaveSettings() {
  return (
    <>
      <LeaveTypes />
      <GazettedPosts />
    </>
  );
}

function LeaveTypes() {
  const { data, error } = useLeaveTypes();
  const a = useLeaveActions();
  const [form, setForm] = useState<LeaveType | "new" | null>(null);
  const [credit, setCredit] = useState<LeaveType | null>(null);
  const types = data?.types ?? [];
  const have = new Set(types.map((t) => t.name.toLowerCase()));
  const missing = USUAL_LEAVE_TYPES.filter((u) => !have.has(u.name.toLowerCase())).length;
  const remove = (t: LeaveType) => confirm(`Remove the leave type "${t.name}"?`) && a.removeType.mutate(t.id);
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <CalendarOff size={18} className="text-brand-700" /> Leave types
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        The leaves kept in each permanent employee's leave account (on their page). Casual leave, compensation leave and other short office leaves aren't kept here.
      </p>
      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Loading className="py-4" />
      ) : (
        <div className="mt-4 space-y-3">
          {missing > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="min-w-0 flex-1 text-footnote text-slate-600">
                Add the usual Kerala Service Rules leaves (EL, HPL, commuted leave, LND, EOL, maternity and paternity leave) with their usual rules. Check the figures once; every one can be changed.
              </p>
              <Button size="sm" onClick={() => a.addUsual.mutate()} disabled={a.addUsual.isPending}>
                <ListPlus size={15} /> {missing === USUAL_LEAVE_TYPES.length ? "Add the usual leaves" : `Add ${missing} more`}
              </Button>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-line">
            {types.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">None yet.</p>
            ) : (
              <SortableList items={types} label={(t) => t.name} onReorder={(ids) => a.orderTypes.mutate(ids)} rowClassName="py-1.5 pr-2 pl-1.5">
                {(t) => (
                  <>
                    <span className="min-w-0 flex-1 py-0.5">
                      <span className="block text-sm text-ink [overflow-wrap:anywhere]">
                        {t.name}
                        {t.short && t.short !== t.name && <span className="text-slate-500"> ({t.short})</span>}
                      </span>
                      <span className="block text-footnote text-slate-500 [overflow-wrap:anywhere]">{ruleText(t, types)}</span>
                    </span>
                    {t.hasAccount && (
                      <IconButton label={`Credit ${t.name} to everyone`} onClick={() => setCredit(t)}>
                        <CalendarPlus size={16} />
                      </IconButton>
                    )}
                    <IconButton label={`Edit ${t.name}`} onClick={() => setForm(t)}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton label={`Remove ${t.name}`} onClick={() => remove(t)} danger>
                      <Trash2 size={16} />
                    </IconButton>
                  </>
                )}
              </SortableList>
            )}
            <div className="border-t border-line bg-slate-50/60 p-2.5">
              <Button onClick={() => setForm("new")}>
                <Plus size={16} /> New leave type
              </Button>
            </div>
          </div>
          <ErrorNote error={a.addUsual.error ?? a.removeType.error ?? a.orderTypes.error} />
          <p className="text-footnote text-slate-500">
            <CalendarPlus size={13} className="inline align-[-2px]" /> credits a year's leave to every permanent employee still in the office (for example 20 days of HPL); anyone already credited for that year is skipped.
            A leave used in an account can't be removed; rename it instead.
          </p>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form === "new" ? "New leave type" : "Edit leave type"}>
        {form && <TypeForm type={form === "new" ? null : form} types={types} onDone={() => setForm(null)} />}
      </Modal>
      <Modal open={!!credit} onClose={() => setCredit(null)} title={credit ? `Credit ${leaveShort(credit)} to everyone` : "Credit"}>
        {credit && <CreditForm type={credit} onDone={() => setCredit(null)} />}
      </Modal>
    </Card>
  );
}

type Balance = "own" | "other" | "none";

function TypeForm({ type, types, onDone }: { type: LeaveType | null; types: LeaveType[]; onDone: () => void }) {
  const { addType, saveType } = useLeaveActions();
  const save = type ? saveType : addType;
  const [v, setV] = useState<LeaveTypeInput>(() =>
    type
      ? { name: type.name, short: type.short, hasAccount: type.hasAccount, drawsOnId: type.drawsOnId, perDay: type.perDay, mayGoNegative: type.mayGoNegative, maxBalance: type.maxBalance, serviceLimit: type.serviceLimit, medical: type.medical, yearlyDays: type.yearlyDays, fromDuty: type.fromDuty, autoCredit: !!type.creditsFrom, delaysIncrement: type.delaysIncrement }
      : { name: "", short: "", hasAccount: true, drawsOnId: null, perDay: 1, mayGoNegative: false, maxBalance: null, serviceLimit: null, medical: false, yearlyDays: null, fromDuty: false, autoCredit: false, delaysIncrement: false },
  );
  const set = <K extends keyof LeaveTypeInput>(k: K, value: LeaveTypeInput[K]) => setV((s) => ({ ...s, [k]: value }));
  const sources = types.filter((t) => t.hasAccount && t.id !== type?.id);
  const balance: Balance = v.drawsOnId ? "other" : v.hasAccount ? "own" : "none";
  const setBalance = (b: Balance) =>
    setV((s) => ({ ...s, hasAccount: b === "own", drawsOnId: b === "other" ? (s.drawsOnId ?? sources[0]?.id ?? null) : null }));
  const credit: "none" | "fixed" | "duty" = v.fromDuty ? "duty" : v.yearlyDays != null ? "fixed" : "none";
  const num = (raw: string) => (raw.trim() === "" ? null : Number(raw));
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    try {
      if (type) await saveType.mutateAsync({ id: type.id, input: v });
      else await addType.mutateAsync(v);
      onDone();
    } catch {
      // shown under the form
    }
  };
  const radio = "inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm text-slate-600 enabled:hover:bg-slate-50 active:scale-[0.97] disabled:opacity-50 aria-checked:border-brand-200 aria-checked:bg-tint aria-checked:font-medium aria-checked:text-brand-800";
  const choice = <T extends string>(label: string, value: T, options: [T, string, boolean?][], onChange: (v: T) => void) => (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {/* Its own buttons (type="button"), so choosing never submits the form. */}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map(([o, text, disabled]) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} disabled={disabled} onClick={() => onChange(o)} className={radio}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 min-[400px]:grid-cols-[1fr_8rem]">
        <Field label="Name">
          <input className={inputClass} value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} autoFocus={!type} placeholder="e.g. Half pay leave" />
        </Field>
        <Field label="Short name">
          <input className={inputClass} value={v.short} onChange={(e) => set("short", e.target.value)} maxLength={12} placeholder="e.g. HPL" />
        </Field>
      </div>
      {choice<Balance>("Balance", balance, [["own", "Its own balance"], ["other", "Takes from another leave", sources.length === 0], ["none", "No balance"]], setBalance)}
      {balance === "own" && (
        <>
          {choice("Yearly credit", credit, [["none", "None"], ["fixed", "Fixed days"], ["duty", "1/11 of days on duty"]], (c) =>
            setV((s) => ({ ...s, fromDuty: c === "duty", yearlyDays: c === "fixed" ? (s.yearlyDays ?? 20) : null })),
          )}
          <p className="-mt-2 text-footnote text-slate-500">
            {credit === "duty"
              ? "Earned leave: on each service anniversary, 1/11 of the days on duty in the year just ended (less leave marked here), for employees whose probation is declared."
              : credit === "fixed"
                ? "On each service anniversary, for each completed year of service."
                : "Credited by hand only (Credit now, or Entry on the employee's page)."}
          </p>
          {credit !== "none" && (
            <>
              <Check2 label="Credit it automatically on each service anniversary" checked={!!v.autoCredit} onChange={(c) => set("autoCredit", c)} />
              <p className="-mt-3 px-1.5 text-footnote text-slate-500">
                {type?.creditsFrom && v.autoCredit
                  ? `Automatic since ${type.creditsFrom.split("-").reverse().join("/")}.`
                  : "From today on; earlier years are never added. Anniversaries on or before an employee's opening balance date are left out, and a year already credited (by hand or Credit now) isn't credited again."}
              </p>
            </>
          )}
          <div className="grid gap-3 min-[400px]:grid-cols-2">
            {credit === "fixed" && (
              <Field label="Days a year">
                <input type="number" inputMode="decimal" min={0.5} max={365} step={0.5} required className={inputClass} value={v.yearlyDays ?? ""} onChange={(e) => set("yearlyDays", num(e.target.value))} />
              </Field>
            )}
            <Field label="Most that can be kept (days)">
              <input type="number" inputMode="decimal" min={0} max={9999} step={0.5} className={inputClass} value={v.maxBalance ?? ""} onChange={(e) => set("maxBalance", num(e.target.value))} placeholder="No limit" />
            </Field>
          </div>
        </>
      )}
      {balance === "other" && (
        <div className="grid gap-3 min-[400px]:grid-cols-2">
          <Field label="Takes from">
            <select className={inputClass} value={v.drawsOnId ?? ""} onChange={(e) => set("drawsOnId", e.target.value || null)}>
              {sources.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Days taken for each day">
            <input type="number" inputMode="decimal" min={0.5} max={5} step={0.5} required className={inputClass} value={v.perDay ?? 1} onChange={(e) => set("perDay", Number(e.target.value) || 1)} />
          </Field>
        </div>
      )}
      {balance === "other" && <Check2 label="The balance may go below zero (leave not due)" checked={!!v.mayGoNegative} onChange={(c) => set("mayGoNegative", c)} />}
      <Field label="Days allowed in the whole service">
        <input type="number" inputMode="decimal" min={0} max={9999} step={0.5} className={inputClass} value={v.serviceLimit ?? ""} onChange={(e) => set("serviceLimit", num(e.target.value))} placeholder="No limit (LND: 360)" />
      </Field>
      <Check2 label="Needs a medical certificate" checked={!!v.medical} onChange={(c) => set("medical", c)} />
      <Check2 label="Doesn't count for increment or probation (EOL): marking it offers to move those dates" checked={!!v.delaysIncrement} onChange={(c) => set("delaysIncrement", c)} />
      <ErrorNote error={save.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          <Check size={16} /> {type ? "Save" : "Add leave type"}
        </Button>
      </div>
    </form>
  );
}

function Check2({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
      <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

// "Credit now": who gets the credit is checked (dry run) as the year changes; anyone already credited for it is skipped.
function CreditForm({ type, onDone }: { type: LeaveType; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const { credit } = useLeaveActions();
  const [year, setYear] = useState(today.slice(0, 4));
  const [onDate, setOnDate] = useState(today);
  const [days, setDays] = useState(type.yearlyDays != null ? String(type.yearlyDays) : "");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<{ give: string[]; already: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const n = Number(days);
  const ready = /^\d{4}$/.test(year) && days.trim() !== "" && n > 0 && !!onDate;
  useEffect(() => {
    setPlan(null);
    if (!ready) return;
    const t = setTimeout(
      () =>
        credit.mutate(
          { id: type.id, creditFor: year, onDate, days: n, note, dryRun: true },
          { onSuccess: (p) => setPlan({ give: p.employees.filter((e) => !e.already).map((e) => e.name), already: p.employees.filter((e) => e.already).length }) },
        ),
      300,
    );
    return () => clearTimeout(t);
    // Checked again only when the year or days change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, days, type.id]);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!ready) return;
    credit.mutate(
      { id: type.id, creditFor: year, onDate, days: n, note, dryRun: false },
      { onSuccess: (r) => setDone(`Credited ${daysWord(n)} ${leaveShort(type)} for ${year} to ${plural(r.credited ?? 0, "employee")}${r.skipped ? ` (${r.skipped} already had it)` : ""}${r.lapsed ? `; ${r.lapsed} went above the most that can be kept, and the extra lapsed` : ""}.`) },
    );
  };
  if (done)
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-low-soft px-3 py-2 text-sm text-low-ink">{done}</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">Adds the days to the {type.name} balance of every permanent employee still in the office, once per year.</p>
      <div className="grid gap-3 min-[400px]:grid-cols-3">
        <Field label="For the year">
          <input inputMode="numeric" className={inputClass} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
        </Field>
        <Field label="Days">
          <input type="number" inputMode="decimal" min={0.5} max={365} step={0.5} required className={inputClass} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Date">
          <input type="date" required className={inputClass} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Note">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={`Yearly credit for ${year || "the year"}`} />
      </Field>
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-footnote text-slate-600">
        {!ready ? (
          "Give the year and the days."
        ) : !plan ? (
          <Loading className="py-1" />
        ) : plan.give.length === 0 ? (
          plan.already ? `Everyone already has the ${year} credit.` : "No permanent employees in the office."
        ) : (
          <>
            <span className="font-medium text-ink">{plural(plan.give.length, "employee")}</span> get {daysWord(n)} {leaveShort(type)}
            {plan.already ? `; ${plan.already} already had the ${year} credit` : ""}.
            <span className="mt-1 block [overflow-wrap:anywhere]">{plan.give.join(", ")}</span>
          </>
        )}
      </div>
      <ErrorNote error={credit.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ready || credit.isPending || !plan?.give.length}>
          <Check size={16} /> {plan?.give.length ? `Credit ${plural(plan.give.length, "employee")}` : "Credit"}
        </Button>
      </div>
    </form>
  );
}

// Which designations are gazetted posts; their employees' Gazetted switch follows the tick.
function GazettedPosts() {
  const { data } = useStaff();
  const { setGazettedPost } = useStaffActions();
  const counts = new Map<string, number>();
  for (const e of data?.employees ?? []) if (e.permanent && !e.leftOn && e.designationId) counts.set(e.designationId, (counts.get(e.designationId) ?? 0) + 1);
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <BadgeCheck size={18} className="text-brand-700" /> Gazetted posts
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Employees of a gazetted post are gazetted officers: their leave has the gazetted steps (CTC, AG payslip). Ticking a post sets its employees; one employee can still be changed in their details.
      </p>
      {!data ? (
        <Loading className="py-4" />
      ) : data.designations.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No designations yet (Settings › Employees).</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {data.designations.map((d) => (
            <li key={d.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5"
                  checked={d.gazetted}
                  onChange={(e) => setGazettedPost.mutate({ id: d.id, gazetted: e.target.checked })}
                />
                <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{d.name}</span>
                {counts.get(d.id) ? <span className="shrink-0 text-footnote text-slate-500">{plural(counts.get(d.id)!, "employee")}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={setGazettedPost.error} />
    </Card>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx("shrink-0 rounded-md p-1.5 text-slate-500 enabled:hover:bg-slate-100 enabled:active:scale-90", danger ? "enabled:hover:text-urgent-ink" : "enabled:hover:text-ink")}
    >
      {children}
    </button>
  );
}
