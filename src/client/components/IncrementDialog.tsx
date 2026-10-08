// Increment done (user request 2026-10-08, extending 2026-10-07's Mark done): marking an employee's increment
// done asks for their new basic pay first (filled in with the current one), saves both together and offers
// Undo, which puts back the increment date and the old basic pay. Opened with openIncrement() from Home's Due
// Today (tick or swipe) and the Employees page's Due increments; it lives once in the app shell.
import { Check, TrendingUp } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { nextYear } from "../../shared/staff";
import { useIncrementDone, useMe } from "../api";
import { formatDay } from "../format";
import { showUndo } from "./SwipeRow";
import { Button, ErrorNote, Field, Modal, inputClass } from "./ui";

export type IncrementRequest = { employeeId: string; name: string; due: string; basicPay: number | null };

let opener: ((r: IncrementRequest) => void) | null = null;
export const openIncrement = (r: IncrementRequest) => opener?.(r);

export function IncrementDialogHost() {
  const [req, setReq] = useState<IncrementRequest | null>(null);
  useEffect(() => {
    opener = setReq;
    return () => {
      opener = null;
    };
  }, []);
  return (
    <Modal open={req !== null} onClose={() => setReq(null)} title="Increment done">
      {req && <IncrementForm key={req.employeeId} req={req} onDone={() => setReq(null)} />}
    </Modal>
  );
}

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function IncrementForm({ req, onDone }: { req: IncrementRequest; onDone: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const done = useIncrementDone();
  const [pay, setPay] = useState(req.basicPay != null ? String(req.basicPay) : "");
  const value = pay.trim() === "" ? null : Number(pay);
  const invalid = value !== null && (!Number.isFinite(value) || value < 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    done
      .mutateAsync({ id: req.employeeId, basicPay: value })
      .then((r) => {
        onDone();
        const payText = r.basicPay != null && r.basicPay !== r.previousBasicPay ? ` · basic pay ${rupees(r.basicPay)}` : "";
        showUndo({
          message: `Increment done: ${req.name}${payText}${r.next ? ` · next ${formatDay(r.next, today)}` : ""}`,
          onUndo: () => r.previous && done.mutate({ id: req.employeeId, undoTo: r.previous, restoreBasicPay: r.previousBasicPay }),
        });
      })
      .catch(() => {});
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="flex gap-2 text-sm text-slate-600">
        <TrendingUp size={18} className="shrink-0 text-brand-700" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-medium text-ink">{req.name}</span> · increment due {formatDay(req.due, today)}. The next one will be due {formatDay(nextYear(req.due), today)}.
        </span>
      </p>
      <Field label="New basic pay (₹)">
        <input
          className={inputClass}
          value={pay}
          onChange={(e) => setPay(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          placeholder="e.g. 42500"
          aria-invalid={invalid}
          autoComplete="off"
        />
      </Field>
      <p className="-mt-2 text-footnote text-slate-500">
        {req.basicPay != null ? `Now ${rupees(req.basicPay)}. ` : ""}Leave it as it is if the pay doesn't change; it can be edited later on the employee's card.
      </p>
      <ErrorNote error={done.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={done.isPending || invalid}>
          <Check size={15} /> Mark done
        </Button>
      </div>
    </form>
  );
}
