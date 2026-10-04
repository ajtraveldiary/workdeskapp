import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-sm" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-brand-700 text-white hover:bg-brand-800",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        className,
      )}
    />
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "red" | "amber" | "brand" | "blue" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "slate" && "bg-slate-100 text-slate-700",
        tone === "red" && "bg-red-50 text-red-700 ring-1 ring-red-200 ring-inset",
        tone === "amber" && "bg-amber-50 text-amber-800 ring-1 ring-amber-200 ring-inset",
        tone === "brand" && "bg-brand-50 text-brand-800 ring-1 ring-brand-100 ring-inset",
        tone === "blue" && "bg-blue-50 text-blue-700 ring-1 ring-blue-200 ring-inset",
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-lg border border-slate-200 bg-white", className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <p className="mt-1 text-sm text-slate-500">{children}</p>}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="inline-flex gap-1 rounded-lg bg-slate-200/60 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span className="rounded bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600">{o.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400 sm:w-64"
    />
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-slate-200 bg-white p-0 shadow-xl"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export const inputClass = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
