// Who attends an event (user request 2026-10-12, "use small button for assign employee like in every other page"):
// a small people-icon button inside the event's title box, as the person button in the task and reminder forms,
// with the chosen people as chips under it. The picker (a menu from the button on wider screens, an action sheet
// on phones) takes several people: tapping one ticks or unticks them and it stays open; a designation's "(all)"
// adds everyone of it still in the office (or takes them all off again).
import { Check, Search, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Employee } from "../../shared/types";
import { useStaff } from "../api";
import { AnchoredMenu } from "./RemoveChooser";
import { usePhone } from "./sheet";
import { ActionSheet, Spinner, cx } from "./ui";

export function TitleWithAttendees({ value, onChange, children }: { value: string[]; onChange: (ids: string[]) => void; children: ReactNode }) {
  const staff = useStaff().data;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const phone = usePhone();
  const close = () => setAnchor(null);
  const name = (id: string) => staff?.employees.find((e) => e.id === id)?.name ?? "Employee";
  const list = <Choices value={value} onChange={onChange} onDone={close} />;
  const n = value.length;
  return (
    <div>
      <div className="relative [&_input]:pr-11">
        {children}
        <span className="absolute inset-y-0 right-1 flex items-center">
          <button
            type="button"
            onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
            aria-expanded={!!anchor}
            aria-label={n ? `${n} attending. Change who attends` : "Who attends? Choose employees"}
            title={n ? `${n} attending` : "Who attends"}
            className={cx(
              "relative flex size-8 items-center justify-center rounded-md active:scale-90 aria-expanded:bg-slate-100",
              n ? "text-brand-700 hover:bg-tint" : "text-slate-400 hover:bg-slate-100 hover:text-ink",
            )}
          >
            <UsersRound size={18} />
            {n > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[0.625rem] leading-4 font-semibold text-white">{n}</span>}
          </button>
        </span>
      </div>
      {n > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-tint py-0.5 pr-0.5 pl-2 text-footnote text-brand-800">
              <span className="min-w-0 [overflow-wrap:anywhere]">{name(id)}</span>
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Remove ${name(id)}`} title="Remove" className="shrink-0 rounded p-0.5 hover:bg-brand-100 active:scale-90">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      {anchor &&
        (phone ? (
          // Outside the form's <label>, so a tap on the sheet doesn't jump to the title box.
          createPortal(
            <ActionSheet onClose={close} title="Who attends?">
              <div className="overflow-hidden rounded-xl bg-white">{list}</div>
            </ActionSheet>,
            document.body,
          )
        ) : (
          <AnchoredMenu anchor={anchor} onClose={close} label="Who attends?">
            {list}
          </AnchoredMenu>
        ))}
    </div>
  );
}

function Choices({ value, onChange, onDone }: { value: string[]; onChange: (ids: string[]) => void; onDone: () => void }) {
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
  const chosen = new Set(value);
  const toggle = (ids: string[]) => {
    const allIn = ids.every((id) => chosen.has(id));
    onChange(allIn ? value.filter((id) => !ids.includes(id)) : [...value, ...ids.filter((id) => !chosen.has(id))]);
  };

  if (isLoading) return <div className="flex justify-center py-4"><Spinner size={18} /></div>;
  const here = (staff?.employees ?? []).filter((e) => !e.leftOn);
  const matches = (e: Employee, dName: string) => !query || e.name.toLowerCase().includes(query) || e.pen.toLowerCase().includes(query) || dName.toLowerCase().includes(query);
  const groups = [
    ...(staff?.designations ?? []).map((d) => ({ id: d.id as string | null, name: d.name, people: here.filter((e) => e.designationId === d.id && matches(e, d.name)) })),
    { id: null, name: "No designation", people: here.filter((e) => !e.designationId && matches(e, "")) },
  ].filter((g) => g.people.length);

  return (
    <div className="p-1">
      <label className="relative mb-1 block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
        <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PEN or designation" aria-label="Search employees" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} className="h-9 w-full rounded-lg border border-line bg-white pr-2 pl-8 text-sm outline-none focus:border-brand-500" />
      </label>
      {groups.map((g) => {
        const ids = g.people.map((e) => e.id);
        const all = ids.every((id) => chosen.has(id));
        return (
          <div key={g.id ?? "none"} className="mt-1 border-t border-line pt-1">
            {g.id ? (
              <button type="button" onClick={() => toggle(ids)} className={cx(item, "font-medium")} aria-pressed={all}>
                <UsersRound size={16} className="shrink-0 text-slate-500" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {g.name} (all)
                  <span className="block text-caption font-normal text-slate-500">Designation · {g.people.length}</span>
                </span>
                {all && <Check size={16} className="shrink-0 text-brand-700" />}
              </button>
            ) : (
              <p className="px-2.5 pt-1 text-caption font-medium text-slate-500">{g.name}</p>
            )}
            {g.people.map((e) => (
              <button key={e.id} type="button" role="checkbox" aria-checked={chosen.has(e.id)} onClick={() => toggle([e.id])} className={cx(item, "pl-6")}>
                <span className={cx("flex size-4 shrink-0 items-center justify-center rounded border", chosen.has(e.id) ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>
                  {chosen.has(e.id) && <Check size={12} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {e.name}
                  {e.pen && <span className="text-caption text-slate-500"> · PEN {e.pen}</span>}
                </span>
              </button>
            ))}
          </div>
        );
      })}
      {query && groups.length === 0 && <p className="px-2.5 py-2 text-footnote text-slate-500">No one matches “{q.trim()}”.</p>}
      {here.length === 0 && <p className="px-2.5 py-2 text-footnote text-slate-500">No employees yet. Add people on the Employees page.</p>}
      <div className="sticky bottom-0 mt-1 border-t border-line bg-white pt-1">
        <button type="button" onClick={onDone} className={cx(item, "justify-center font-medium text-brand-700")}>
          Done{value.length ? ` · ${value.length} chosen` : ""}
        </button>
      </div>
    </div>
  );
}
