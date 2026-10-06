import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { usePhone, usePullToClose } from "./sheet";
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition enabled:active:scale-[0.97] disabled:opacity-50 [&_svg]:shrink-0",
        size === "sm" ? "h-8 px-3 text-footnote pointer-coarse:h-9" : "h-10 px-4 text-sm pointer-coarse:h-9",
        variant === "primary" && "bg-brand-600 text-white shadow-sm enabled:hover:bg-brand-700 enabled:hover:shadow-md",
        variant === "secondary" && "border border-line bg-white text-slate-700 enabled:hover:border-slate-300 enabled:hover:bg-slate-50 enabled:hover:text-ink",
        variant === "ghost" && "text-slate-600 enabled:hover:bg-slate-100 enabled:hover:text-slate-900",
        variant === "danger" && "border border-urgent/40 bg-white text-urgent-ink enabled:hover:bg-urgent-soft",
        className,
      )}
    />
  );
}

// Colour carries meaning (see styles.css): urgent red > high orange > medium yellow > low green,
// plus snooze purple, info blue, brand pastel red (actions; was blue) and neutral grey.
// soft: tinted background + dark text (tags, chips). solid: saturated fill (icon tiles, badges). dot: accent only.
export type Tone = "urgent" | "high" | "medium" | "low" | "snooze" | "info" | "brand" | "neutral";

export const TONE: Record<Tone, { soft: string; solid: string; dot: string }> = {
  urgent: { soft: "bg-urgent-soft text-urgent-ink", solid: "bg-urgent text-white", dot: "bg-urgent" },
  high: { soft: "bg-high-soft text-high-ink", solid: "bg-high text-white", dot: "bg-high" },
  medium: { soft: "bg-medium-soft text-medium-ink", solid: "bg-medium text-ink", dot: "bg-medium" },
  low: { soft: "bg-low-soft text-low-ink", solid: "bg-low text-white", dot: "bg-low" },
  snooze: { soft: "bg-snooze-soft text-snooze-ink", solid: "bg-snooze text-white", dot: "bg-snooze" },
  info: { soft: "bg-info-soft text-info-ink", solid: "bg-info text-white", dot: "bg-info" },
  brand: { soft: "bg-brand-100 text-brand-800", solid: "bg-brand-600 text-white", dot: "bg-brand-600" },
  neutral: { soft: "bg-slate-100 text-slate-700", solid: "bg-slate-500 text-white", dot: "bg-slate-400" },
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
    // Title on the left, buttons on the right of the same line (never wrapping under a long subtitle); the
    // title's line is as tall as the buttons so both share one centre line (alignment pass 2026-10-06).
    <header className="mb-3 flex items-start justify-between gap-3 sm:mb-5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-title3 leading-9 font-bold text-ink sm:text-title2 sm:leading-10 sm:font-semibold">{title}</h1>
        {subtitle && <p className="hidden text-sm text-slate-500 sm:block">{subtitle}</p>}
      </div>
      {actions && <div className="flex h-9 shrink-0 items-center gap-2 sm:h-10">{actions}</div>}
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
    <div className="no-scrollbar -mx-3 mb-3 overflow-x-auto px-3 sm:mx-0 sm:mb-4 sm:px-0">
      <div role="tablist" className="flex gap-4 border-b border-line sm:gap-6">
        {options.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-sm whitespace-nowrap active:scale-[0.97]",
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
      className="h-10 w-full rounded-lg border border-line bg-white px-3.5 text-sm outline-none placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 pointer-coarse:h-9 sm:w-72"
    />
  );
}

// Pop-up forms. Phones get an app-style sheet from the bottom with a grab handle that can be pulled down to
// close (user request 2026-10-06: every part of the app should act like a mobile app).
// closeOnBackdrop: a tap outside the box closes it (read-only views such as Task details, user request
// 2026-10-06); forms leave it off so a stray tap can't lose what was typed.
export function Modal({ open, onClose, title, children, closeOnBackdrop }: { open: boolean; onClose: () => void; title: string; children: ReactNode; closeOnBackdrop?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.style.transition = "";
      d.style.transform = ""; // where a pull-to-close left it
      // With autofocus on the dialog itself the browser focuses the box, never the ✕ (no ring on it).
      d.setAttribute("autofocus", "");
      d.showModal();
      // The browser focuses the first button (the ✕), which then shows a focus ring on phones (2026-10-06).
      // Focus the box itself instead, unless a field took the focus; Tab still reaches the buttons.
      if (!(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) d.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  usePullToClose(ref, onClose, open);
  return (
    <dialog
      ref={ref}
      // Only its own close: menus opened inside it are dialogs too.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      // The dialog element itself is only hit outside its content box (the dimmed backdrop).
      onClick={closeOnBackdrop ? (e) => e.target === e.currentTarget && onClose() : undefined}
      tabIndex={-1}
      aria-label={title}
      data-sheet-scroll
      className="outline-none m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line bg-white p-0 shadow-xl sheet max-sm:mx-0 max-sm:mt-auto max-sm:mb-0 max-sm:max-h-[92dvh] max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      {open && (
        // The safe-area space is inside the content, so a tap there isn't taken as a tap outside.
        <div className="p-5 max-sm:px-4 max-sm:pt-2 max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-9 rounded-full bg-slate-300 sm:hidden" />
          <div className="mb-4 flex items-start justify-between gap-4">
            {/* Sheet title like iOS (headline, semibold) on phones. */}
            <h2 className="text-headline font-semibold text-ink sm:text-lg sm:font-medium">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-ink active:scale-90 pointer-coarse:p-2" aria-label="Close">
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:opacity-60 pointer-coarse:h-9";

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
  oneRow,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number; tone?: Tone }[];
  // Keep one sideways-scrolling row on every screen size (narrow panels) instead of wrapping.
  oneRow?: boolean;
}) {
  return (
    <div role="tablist" className={cx("no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3", oneRow ? "sm:-mx-5 sm:px-5" : "sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0")}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-footnote whitespace-nowrap transition active:scale-[0.97]",
            // Phones: one-row tabs share the width evenly so a few of them fit without scrolling.
            oneRow && "max-sm:flex-1 max-sm:justify-center max-sm:px-2",
            value === o.value
              ? "border-brand-200 bg-tint font-medium text-brand-800"
              : "border-line bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-ink",
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
    <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium", TONE[PRIORITY_TONE[priority]].soft)}>
      <span className={cx("size-1.5 rounded-full", TONE[PRIORITY_TONE[priority]].dot)} aria-hidden />
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
// A drop-down panel (menus, labels, notifications, account). On phones it opens as an action sheet from
// the bottom of the screen, like iPhone apps, with Cancel; elsewhere it is the usual drop-down (className).
// It is a dialog inside the trigger's container, so the container's tap-outside check still sees it as inside.
export function PopPanel({ onClose, className, title, children }: { onClose: () => void; className: string; title?: string; children: ReactNode }) {
  const phone = usePhone();
  if (!phone) return <div className={className}>{children}</div>;
  return (
    <ActionSheet onClose={onClose} title={title}>
      {children}
    </ActionSheet>
  );
}

function ActionSheet({ onClose, title, children }: { onClose: () => void; title?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.setAttribute("autofocus", ""); // focus the sheet, not its first button
      d.showModal();
    }
    return () => d?.close();
  }, []);
  usePullToClose(ref, onClose, true);
  return (
    <dialog
      ref={ref}
      aria-label={title ?? "Options"}
      onClose={(e) => {
        e.stopPropagation(); // not the email viewer or form it was opened from
        // A late close event from React's development double-mount arrives after it reopened: ignore it.
        if (!e.currentTarget.open) onClose();
      }}
      // A tap on the dimmed area above the sheet closes it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="sheet action-sheet m-0 mt-auto max-h-[80dvh] w-full max-w-none overflow-y-auto rounded-t-2xl bg-white p-0 pb-[env(safe-area-inset-bottom)] text-base outline-none"
    >
      <div className="px-2 pt-2 pb-2">
        <span aria-hidden="true" className="mx-auto mb-1.5 block h-1 w-9 rounded-full bg-slate-300" />
        {title && <p className="px-3 pt-1 pb-2 text-center text-footnote font-medium text-slate-500">{title}</p>}
        {children}
        <button onClick={onClose} className="sheet-cancel mt-2 block w-full rounded-xl bg-slate-100 py-3 text-center text-subhead font-medium text-ink active:bg-slate-200">
          Cancel
        </button>
      </div>
    </dialog>
  );
}

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
        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink active:scale-90 aria-expanded:bg-slate-100 aria-expanded:text-ink pointer-coarse:p-2"
        aria-label={label}
        aria-expanded={open}
      >
        {trigger ?? <MoreVertical size={18} />}
      </button>
      {open && (
        <PopPanel onClose={() => setOpen(false)} className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-line bg-white p-1 shadow-lg">
          {shown.map((it) =>
            it.href ? (
              <a key={it.label} href={it.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50 pointer-coarse:py-2.5">
                {it.label}
              </a>
            ) : (
              <button
                key={it.label}
                onClick={() => {
                  it.onClick?.();
                  setOpen(false);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 pointer-coarse:py-2.5"
              >
                {it.label}
              </button>
            ),
          )}
        </PopPanel>
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
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 pointer-coarse:size-6",
        checked ? "border-low bg-low text-white" : "border-slate-300 text-transparent hover:border-low hover:text-low",
      )}
    >
      <Check size={12} strokeWidth={3} />
    </button>
  );
}

// Loading states (user request 2026-10-06): a spinner for short waits, shimmering placeholder rows for lists,
// and the logo splash while the app starts (same look as the splash in index.html, styled there).
export function Spinner({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cx("shrink-0 animate-spin text-brand-600", className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cx("flex justify-center py-12", className)}>
      <Spinner />
      <span className="sr-only">{label}</span>
    </div>
  );
}

const SKELETON_WIDTHS = ["78%", "62%", "86%", "54%", "70%"];

export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" className={cx("divide-y divide-line px-3 sm:px-5", className)}>
      <span className="sr-only">Loading…</span>
      {SKELETON_WIDTHS.slice(0, rows).map((w) => (
        <div key={w} aria-hidden="true" className="flex items-center gap-3 py-3.5">
          <span className="skeleton size-5 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="skeleton block h-3" style={{ width: w }} />
            <span className="skeleton block h-2.5 w-1/3" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function Splash() {
  return (
    <div className="wd-splash" role="status" aria-label="Loading WorkDesk">
      <span className="wd-splash-logo">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 16.5l5 5 11-11" /></svg>
      </span>
      <span className="wd-splash-spin" aria-hidden="true" />
    </div>
  );
}
