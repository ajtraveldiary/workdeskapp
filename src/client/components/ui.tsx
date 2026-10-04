import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, MoreVertical, X } from "lucide-react";

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
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-line bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        variant === "danger" && "border border-urgent/40 bg-white text-urgent-ink hover:bg-urgent-soft",
        className,
      )}
    />
  );
}

// Colour carries meaning (see styles.css): urgent > high > medium > low, plus snooze, brand and neutral.
export type Tone = "urgent" | "high" | "medium" | "low" | "snooze" | "brand" | "neutral";

export const TONE: Record<Tone, { soft: string; solid: string; dot: string }> = {
  urgent: { soft: "bg-urgent-soft text-urgent-ink", solid: "bg-urgent text-white", dot: "bg-urgent" },
  high: { soft: "bg-high-soft text-high-ink", solid: "bg-high text-ink", dot: "bg-high" },
  medium: { soft: "bg-medium-soft text-medium-ink", solid: "bg-medium text-white", dot: "bg-medium" },
  low: { soft: "bg-low-soft text-low-ink", solid: "bg-low text-white", dot: "bg-low" },
  snooze: { soft: "bg-snooze-soft text-snooze-ink", solid: "bg-snooze text-white", dot: "bg-snooze" },
  brand: { soft: "bg-brand-100 text-brand-800", solid: "bg-brand-600 text-white", dot: "bg-brand-500" },
  neutral: { soft: "bg-slate-100 text-slate-700", solid: "bg-slate-500 text-white", dot: "bg-slate-300" },
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone].soft)}>
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-xl border border-line bg-white", className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-medium text-ink">{title}</h1>
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
      <div role="tablist" className="flex gap-6 border-b border-line">
        {options.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-sm whitespace-nowrap",
              value === o.value ? "border-brand-600 font-medium text-ink" : "border-transparent text-slate-500 hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span className="rounded-full bg-brand-100 px-1.5 text-xs tabular-nums text-brand-700">{o.count}</span>
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
      className="h-10 w-full rounded-lg border border-line bg-white px-3.5 text-sm placeholder:text-slate-400 focus:border-brand-200 sm:w-72"
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
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line bg-white p-0 shadow-xl"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-medium text-ink">{title}</h2>
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

export const inputClass = "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-brand-200";

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
    <p className="rounded-md bg-urgent-soft px-3 py-2 text-sm text-urgent-ink">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

// Pill-style segmented tabs (used on the home panels).
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number; tone?: Tone }[];
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
            value === o.value
              ? "border-brand-200 bg-tint font-medium text-brand-800"
              : "border-line bg-white text-slate-600 hover:border-slate-300 hover:text-ink",
          )}
        >
          {o.tone && <span className={cx("size-2 rounded-full", TONE[o.tone].dot)} aria-hidden />}
          {o.label}
          {o.count !== undefined && <span className="ml-1 tabular-nums">({o.count})</span>}
        </button>
      ))}
    </div>
  );
}

// Task priority -> tone. Stored "normal" is shown as "Medium".
export const PRIORITY_TONE = { urgent: "urgent", high: "high", normal: "medium", low: "low" } as const satisfies Record<string, Tone>;
const PRIORITY_LABEL = { urgent: "Urgent", high: "High", normal: "Medium", low: "Low" } as const;

export function PriorityPill({ priority }: { priority: keyof typeof PRIORITY_TONE }) {
  return (
    <span className={cx("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", TONE[PRIORITY_TONE[priority]].soft)}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export const PRIORITY_BAR = {
  urgent: "bg-urgent",
  high: "bg-high",
  normal: "bg-medium",
  low: "bg-low",
} as const;

export type MenuItem = { label: string; onClick?: () => void; href?: string; hidden?: boolean };

// Kebab menu. Closes on outside click or Escape.
export function Menu({ items, label = "More actions", trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const shown = items.filter((i) => !i.hidden);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink"
        aria-label={label}
        aria-expanded={open}
      >
        {trigger ?? <MoreVertical size={18} />}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-line bg-white p-1 shadow-lg">
          {shown.map((it) =>
            it.href ? (
              <a key={it.label} href={it.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                {it.label}
              </a>
            ) : (
              <button
                key={it.label}
                onClick={() => {
                  it.onClick?.();
                  setOpen(false);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// Small round checkbox used to complete tasks.
export function CheckCircle({ checked, onToggle, label, disabled }: { checked: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "flex size-[22px] shrink-0 items-center justify-center rounded-md border-2 transition-colors",
        checked ? "border-low bg-low text-white" : "border-slate-300 text-transparent hover:border-low hover:text-low",
      )}
    >
      <Check size={13} strokeWidth={3} />
    </button>
  );
}
