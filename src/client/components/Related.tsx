// What a task or reminder is about (user request 2026-10-07, Staff page): one employee, one designation (all
// staff of that kind) or the general office. A small person-icon button opens the picker (a menu growing out of
// the button on wider screens, an action sheet on phones); RelatedTag shows the choice on rows and cards.
import { Building2, Check, Search, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Employee, StaffList } from "../../shared/types";
import type { RelatedKind } from "../../shared/staff";
import { useStaff } from "../api";
import { AnchoredMenu } from "./RemoveChooser";
import { usePhone } from "./sheet";
import { ActionSheet, Spinner, cx } from "./ui";

export type RelatedValue = { relatedKind: RelatedKind | null; relatedId: string | null };
export const NO_RELATED: RelatedValue = { relatedKind: null, relatedId: null };

type Described = { icon: typeof UserRound; name: string; detail: string };

// Name and icon for a choice; null when nothing is chosen (or the employee / designation no longer exists).
export function describeRelated(staff: StaffList | undefined, v: RelatedValue): Described | null {
  if (v.relatedKind === "office") return { icon: Building2, name: "General office", detail: "" };
  if (!v.relatedKind || !v.relatedId || !staff) return null;
  if (v.relatedKind === "designation") {
    const d = staff.designations.find((x) => x.id === v.relatedId);
    return d ? { icon: UsersRound, name: `${d.name} (all)`, detail: "Designation" } : null;
  }
  const e = staff.employees.find((x) => x.id === v.relatedId);
  if (!e) return null;
  const d = staff.designations.find((x) => x.id === e.designationId);
  return { icon: UserRound, name: e.name, detail: [d?.name, e.leftOn && "left the office"].filter(Boolean).join(" · ") };
}

// The small grey chip on task and reminder rows.
export function RelatedTag({ value, className }: { value: RelatedValue; className?: string }) {
  const staff = useStaff().data;
  const d = describeRelated(staff, value);
  if (!d) return null;
  return (
    <span className={cx("inline-flex max-w-44 min-w-0 items-center gap-1 text-slate-500", className)} title={[d.name, d.detail].filter(Boolean).join(" · ")}>
      <d.icon size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{d.name}</span>
    </span>
  );
}

// The person-icon button; children is the field it sits in (the title box), which gets room on its right.
export function TitleWithRelated({ value, onChange, children }: { value: RelatedValue; onChange: (v: RelatedValue) => void; children: ReactNode }) {
  const staff = useStaff().data;
  const d = describeRelated(staff, value);
  return (
    <div>
      <div className="relative [&_input]:pr-11">
        {children}
        <span className="absolute inset-y-0 right-1 flex items-center">
          <RelatedPicker value={value} onChange={onChange}>
            {(open, isOpen) => (
              <button
                type="button"
                onClick={open}
                aria-expanded={isOpen}
                aria-label={d ? `About: ${d.name}. Change` : "What is it about? Employee, designation or office"}
                title={d ? `About: ${d.name}` : "Employee, designation or office"}
                className={cx(
                  "flex size-8 items-center justify-center rounded-md active:scale-90 aria-expanded:bg-slate-100",
                  d ? "text-brand-700 hover:bg-tint" : "text-slate-400 hover:bg-slate-100 hover:text-ink",
                )}
              >
                {d ? <d.icon size={18} /> : <UserRound size={18} />}
              </button>
            )}
          </RelatedPicker>
        </span>
      </div>
      {d && (
        <span className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md bg-tint py-0.5 pr-0.5 pl-2 text-footnote text-brand-800">
          <d.icon size={13} className="shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {d.name}
            {d.detail && <span className="text-brand-800/70"> · {d.detail}</span>}
          </span>
          <button type="button" onClick={() => onChange(NO_RELATED)} aria-label="Remove link to employee" title="Remove" className="shrink-0 rounded p-0.5 hover:bg-brand-100 active:scale-90">
            <X size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

// Opens the picker from any trigger (children gets open() and whether it is open).
export function RelatedPicker({ value, onChange, children }: { value: RelatedValue; onChange: (v: RelatedValue) => void; children: (open: (e: React.MouseEvent<HTMLElement>) => void, isOpen: boolean) => ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const phone = usePhone();
  const close = () => setAnchor(null);
  const pick = (v: RelatedValue) => {
    onChange(v);
    close();
  };
  const list = <Choices value={value} onPick={pick} />;
  return (
    <>
      {children((e) => setAnchor(anchor ? null : e.currentTarget), !!anchor)}
      {anchor &&
        (phone ? (
          // Outside the form's <label>, so a tap on the sheet doesn't jump to the title box.
          createPortal(
            <ActionSheet onClose={close} title="What is it about?">
              <div className="overflow-hidden rounded-xl bg-white">{list}</div>
            </ActionSheet>,
            document.body,
          )
        ) : (
          <AnchoredMenu anchor={anchor} onClose={close} label="What is it about?">
            {list}
          </AnchoredMenu>
        ))}
    </>
  );
}

function Choices({ value, onPick }: { value: RelatedValue; onPick: (v: RelatedValue) => void }) {
  const { data: staff, isLoading } = useStaff();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  // On touch screens the search box waits for a tap, so the keyboard doesn't cover the list as it opens.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const f = requestAnimationFrame(() => document.activeElement === search.current && search.current?.blur());
    return () => cancelAnimationFrame(f);
  }, []);
  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm enabled:hover:bg-slate-50 enabled:active:bg-slate-100 pointer-coarse:py-2.5";
  const isOn = (kind: RelatedKind, id: string | null) => value.relatedKind === kind && value.relatedId === id;
  const tick = (on: boolean) => (on ? <Check size={16} className="shrink-0 text-brand-700" /> : null);

  if (isLoading) return <div className="flex justify-center py-4"><Spinner size={18} /></div>;
  const here = (staff?.employees ?? []).filter((e) => !e.leftOn);
  const matches = (e: Employee, dName: string) => !query || e.name.toLowerCase().includes(query) || e.pen.toLowerCase().includes(query) || dName.toLowerCase().includes(query);
  const groups = [
    ...(staff?.designations ?? []).map((d) => ({ id: d.id as string | null, name: d.name, people: here.filter((e) => e.designationId === d.id && matches(e, d.name)), show: !query || d.name.toLowerCase().includes(query) })),
    { id: null, name: "No designation", people: here.filter((e) => !e.designationId && matches(e, "")), show: false },
  ].filter((g) => g.people.length || g.show);
  const empty = !staff || (staff.designations.length === 0 && here.length === 0);

  return (
    <div className="p-1">
      <label className="relative mb-1 block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
        <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PEN or designation" aria-label="Search employees" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} className="h-9 w-full rounded-lg border border-line bg-white pr-2 pl-8 text-sm outline-none focus:border-brand-500" />
      </label>
      {value.relatedKind && (
        <button type="button" onClick={() => onPick(NO_RELATED)} className={cx(item, "text-slate-600")}>
          <X size={16} className="shrink-0" /> <span className="flex-1">Not linked</span>
        </button>
      )}
      {!query && (
        <button type="button" onClick={() => onPick({ relatedKind: "office", relatedId: null })} className={item}>
          <Building2 size={16} className="shrink-0 text-slate-500" /> <span className="flex-1">General office</span>
          {tick(value.relatedKind === "office")}
        </button>
      )}
      {groups.map((g) => (
        <div key={g.id ?? "none"} className="mt-1 border-t border-line pt-1">
          {g.id ? (
            <button type="button" onClick={() => onPick({ relatedKind: "designation", relatedId: g.id })} className={cx(item, "font-medium")}>
              <UsersRound size={16} className="shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {g.name} (all)
                <span className="block text-caption font-normal text-slate-500">Designation{g.people.length ? ` · ${g.people.length}` : ""}</span>
              </span>
              {tick(isOn("designation", g.id))}
            </button>
          ) : (
            <p className="px-2.5 pt-1 text-caption font-medium text-slate-500">{g.name}</p>
          )}
          {g.people.map((e) => (
            <button key={e.id} type="button" onClick={() => onPick({ relatedKind: "employee", relatedId: e.id })} className={cx(item, "pl-6")}>
              <UserRound size={15} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {e.name}
                {e.pen && <span className="text-caption text-slate-500"> · PEN {e.pen}</span>}
              </span>
              {tick(isOn("employee", e.id))}
            </button>
          ))}
        </div>
      ))}
      {query && groups.length === 0 && <p className="px-2.5 py-2 text-footnote text-slate-500">No one matches “{q.trim()}”.</p>}
      {empty && <p className="px-2.5 py-2 text-footnote text-slate-500">No employees yet. Add designations and employees on the Employees page (profile menu on phones, side bar on computers).</p>}
    </div>
  );
}

// The "For" line of Task details and Reminder details: shows the choice and changes it straight away.
export function RelatedLine({ value, onChange, busy }: { value: RelatedValue; onChange: (v: RelatedValue) => void; busy?: boolean }) {
  const staff = useStaff().data;
  const d = describeRelated(staff, value);
  return (
    <RelatedPicker value={value} onChange={onChange}>
      {(open, isOpen) => (
        <button
          type="button"
          onClick={open}
          aria-expanded={isOpen}
          disabled={busy}
          className="inline-flex max-w-full items-start gap-1.5 rounded-md text-left hover:text-brand-700 active:opacity-70 disabled:opacity-50"
        >
          {d ? (
            <>
              <d.icon size={14} className="mt-[3px] shrink-0 text-slate-500" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {d.name}
                {d.detail && <span className="text-slate-500"> · {d.detail}</span>}
              </span>
            </>
          ) : (
            <span className="text-slate-500">Not linked</span>
          )}
          <span className="shrink-0 text-footnote font-medium text-brand-700">{d ? "Change" : "Choose"}</span>
        </button>
      )}
    </RelatedPicker>
  );
}
