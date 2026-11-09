// Posts (user request 2026-11-10, "make gazetted and weekly off designation wise, with individual exceptions"):
// Settings › Employees card, after the designations. Each designation on one line with its Day off (Sunday off /
// Weekly off) and Gazetted (Yes / No), saved at once; its employees still in the office follow it, except those set
// individually in the employee form ("n set individually" says how many, with their names in its hint). Gazetted is
// the same setting as Settings › Leave › Gazetted posts, and is for permanent staff only.
import { useMemo } from "react";
import { BriefcaseBusiness } from "lucide-react";
import type { OffDay } from "../../shared/staff";
import { OFF_DAYS, OFF_DAY_LABELS } from "../../shared/staff";
import { useStaff, useStaffActions } from "../api";
import { Card, ErrorNote, Loading, cx } from "./ui";

const pill = (on: boolean) =>
  cx(
    "inline-flex h-8 min-w-12 items-center justify-center rounded-lg border px-2.5 text-footnote transition active:scale-[0.97] pointer-coarse:h-9",
    on ? "border-brand-200 bg-tint font-medium text-brand-800" : "border-line text-slate-600 hover:bg-slate-50",
  );

export function PostSettings() {
  const { data, error } = useStaff();
  const { setGazettedPost, setOffDayPost } = useStaffActions();
  // Employees still here, by designation: how many, and who is set individually.
  const people = useMemo(() => {
    const out = new Map<string, { n: number; own: string[] }>();
    for (const e of data?.employees ?? []) {
      if (e.leftOn || !e.designationId) continue;
      const p = out.get(e.designationId) ?? { n: 0, own: [] };
      p.n++;
      if (e.offDayOwn || (e.permanent && e.gazettedOwn)) p.own.push(e.name);
      out.set(e.designationId, p);
    }
    return out;
  }, [data]);
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <BriefcaseBusiness size={18} className="text-brand-700" /> Posts
      </h2>
      <p className="mt-1 text-sm text-slate-600">Each designation&rsquo;s day off and whether it is a gazetted post. Its employees follow it, except anyone set individually in their employee form.</p>
      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Loading className="py-4" />
      ) : data.designations.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Add designations above first.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {data.designations.map((d) => {
            const p = people.get(d.id) ?? { n: 0, own: [] };
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{d.name}</p>
                  <p className="text-caption text-slate-500" title={p.own.length ? `Set individually: ${p.own.join(", ")}` : undefined}>
                    {p.n} {p.n === 1 ? "employee" : "employees"}
                    {p.own.length > 0 && ` · ${p.own.length} set individually`}
                  </p>
                </div>
                <div role="radiogroup" aria-label={`${d.name}: day off`} className="flex gap-1.5">
                  {OFF_DAYS.map((o: OffDay) => (
                    <button key={o} type="button" role="radio" aria-checked={d.offDay === o} onClick={() => d.offDay !== o && setOffDayPost.mutate({ id: d.id, offDay: o })} className={pill(d.offDay === o)}>
                      {OFF_DAY_LABELS[o]}
                    </button>
                  ))}
                </div>
                <div role="radiogroup" aria-label={`${d.name}: gazetted post`} className="flex items-center gap-1.5">
                  <span className="text-footnote text-slate-500">Gazetted</span>
                  {([true, false] as const).map((g) => (
                    <button key={String(g)} type="button" role="radio" aria-checked={d.gazetted === g} onClick={() => d.gazetted !== g && setGazettedPost.mutate({ id: d.id, gazetted: g })} className={pill(d.gazetted === g)}>
                      {g ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorNote error={setOffDayPost.error ?? setGazettedPost.error} />
    </Card>
  );
}
