// Phone rows act like a mobile app's list: swipe right for the main action (complete a task, turn an email
// into a task), swipe left to reveal the other actions as buttons. The row's own action buttons are hidden
// in this mode so the text gets the full width. Mouse and tablet layouts keep their buttons and are unchanged.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useReopenTask, useRestore } from "../api";
import { TONE, cx, type Tone } from "./ui";

// --- Phone detection: touch screen narrower than the desktop layout (same breakpoint as the bottom nav) ---

const PHONE = "(pointer: coarse) and (max-width: 767.98px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export function useSwipeMode() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
}

// --- The row ---

export type SwipeAction = {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  // May return a promise: the row stays swiped away until it settles (by then the list has usually dropped it).
  onClick?: () => unknown;
  href?: string; // opened in a new tab (Gmail)
  hidden?: boolean;
};

const ACTION_W = 68;
// Only one row is open at a time.
let closeOpenRow: (() => void) | null = null;
// The first row shown on a phone briefly slides both ways once, so the gestures can be found.
const HINT_KEY = "workdesk-swipe-hint";
let hintClaimed = false;

export function SwipeRow({
  className,
  contentClassName,
  leading,
  trailing = [],
  children,
}: {
  className?: string; // outer element (margins)
  contentClassName?: string; // the row itself (layout, padding, background)
  leading?: SwipeAction | null; // swipe right
  trailing?: SwipeAction[]; // swipe left
  children: ReactNode;
}) {
  const swipe = useSwipeMode();
  const shown = trailing.filter((a) => !a.hidden);
  const lead = leading && !leading.hidden ? leading : null;
  const trailW = shown.length * ACTION_W;

  const rowRef = useRef<HTMLLIElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [offset, setOffsetState] = useState(0);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(0);
  const busy = useRef(false);
  // The click that follows a swipe (or a tap that closes an open row) is swallowed until this time.
  const suppressClick = useRef(0);
  const mounted = useRef(true);
  // Stable functions (the touch listeners and the "only one open row" check hold on to them).
  const { setOffset, close } = useRef({
    setOffset: (x: number) => {
      offsetRef.current = x;
      setOffsetState(x);
    },
    close: () => {
      offsetRef.current = 0;
      setOffsetState(0);
    },
  }).current;
  const config = useRef({ lead, trailW });
  config.current = { lead, trailW };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fire = async (action: SwipeAction) => {
    busy.current = true;
    setOffset(rowRef.current?.offsetWidth ?? 400);
    try {
      await Promise.all([action.onClick?.(), new Promise((r) => setTimeout(r, 250))]);
    } catch {
      // The action shows its own error state; just bring the row back.
    }
    busy.current = false;
    if (mounted.current) close();
  };

  // Touch handling (native listeners: the move handler must be able to stop the page scrolling sideways).
  useEffect(() => {
    const el = contentRef.current;
    if (!swipe || !el) return;
    let startX = 0;
    let startY = 0;
    let base = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let mode: "none" | "h" | "v" = "none";

    const limit = (x: number) => {
      const { lead, trailW } = config.current;
      if (x > 0) return lead ? x : x * 0.15;
      if (trailW === 0) return x * 0.15;
      return x < -trailW ? -trailW + (x + trailW) * 0.25 : x;
    };
    const onStart = (e: TouchEvent) => {
      // Dialogs opened from a row sit inside it in the page; touches there aren't swipes.
      mode = "v";
      if (e.touches.length !== 1 || busy.current || (e.target as Element).closest?.("dialog")) return;
      const t = e.touches[0]!;
      startX = lastX = t.clientX;
      startY = t.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      base = offsetRef.current;
      mode = "none";
      suppressClick.current = 0;
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
    };
    const onMove = (e: TouchEvent) => {
      if (mode === "v" || busy.current) return;
      const t = e.touches[0]!;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (mode === "none") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
        if (mode === "v") return;
        setDragging(true);
      }
      e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (t.clientX - lastX) / dt;
      lastX = t.clientX;
      lastT = e.timeStamp;
      setOffset(limit(base + dx));
    };
    const onEnd = () => {
      if (busy.current) return;
      if (mode === "none" && base !== 0) {
        // A tap on an open row closes it instead of opening the item.
        suppressClick.current = Date.now() + 500;
        close();
        return;
      }
      if (mode !== "h") return;
      setDragging(false);
      suppressClick.current = Date.now() + 500;
      const { lead, trailW } = config.current;
      const x = offsetRef.current;
      const width = el.offsetWidth;
      if (lead && x > Math.min(120, width * 0.35)) return void fire(lead);
      if (trailW && x < 0 && (x < -trailW / 2 || velocity < -0.5) && velocity < 0.5) {
        setOffset(-trailW);
        closeOpenRow = close;
        return;
      }
      close();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipe]);

  // An open row closes when anything outside it is touched.
  useEffect(() => {
    if (offset >= 0 || dragging) return;
    const outside = (e: PointerEvent) => !rowRef.current?.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset < 0, dragging]);

  // One-time hint.
  useEffect(() => {
    if (!swipe || hintClaimed || (!lead && !trailW)) return;
    let seen = true;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {
      // Storage blocked: skip the hint.
    }
    if (seen) return;
    hintClaimed = true;
    const steps: [number, number][] = [
      [700, lead ? 56 : 0],
      [1150, 0],
      [1500, trailW ? -Math.min(trailW, 72) : 0],
      [1950, 0],
    ];
    const timers = steps.map(([at, x]) => setTimeout(() => !busy.current && setOffset(x), at));
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Ignore.
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipe]);

  if (!swipe) return <li className={cx(className, contentClassName)}>{children}</li>;

  const leadPast = lead && offset > Math.min(120, (rowRef.current?.offsetWidth ?? 360) * 0.35);
  return (
    <li ref={rowRef} className={cx("relative overflow-hidden", className)}>
      {lead && (
        <button
          type="button"
          tabIndex={offset > 0 ? 0 : -1}
          onClick={() => fire(lead)}
          aria-label={lead.label}
          className={cx("no-tap absolute inset-y-0 left-0 flex items-center gap-2 overflow-hidden pl-4 text-footnote font-medium whitespace-nowrap", TONE[lead.tone].solid)}
          style={{ width: Math.max(offset, 0) }}
        >
          <lead.icon size={20} className={cx("shrink-0 transition-transform", leadPast && "scale-125")} />
          {lead.label}
        </button>
      )}
      {shown.length > 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: trailW }} aria-label="Actions">
          {shown.map((a) => {
            const inner = (
              <>
                <a.icon size={19} className="shrink-0" />
                <span className="max-w-full truncate px-1">{a.label}</span>
              </>
            );
            const cls = cx("no-tap flex flex-col items-center justify-center gap-1 text-caption2 font-medium active:brightness-90", TONE[a.tone].solid);
            const after = () => close();
            return a.href ? (
              <a key={a.label} href={a.href} target="_blank" rel="noreferrer" onClick={after} onFocus={() => setOffset(-trailW)} className={cls} style={{ width: ACTION_W }}>
                {inner}
              </a>
            ) : (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  after();
                  a.onClick?.();
                }}
                onFocus={() => setOffset(-trailW)}
                className={cls}
                style={{ width: ACTION_W }}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
      <div
        ref={contentRef}
        onClickCapture={(e) => {
          if (Date.now() < suppressClick.current && !(e.target as Element).closest("dialog")) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = 0;
          }
        }}
        className="relative bg-white"
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: dragging ? "none" : "transform 220ms cubic-bezier(.2,.8,.2,1)",
          touchAction: "pan-y",
        }}
      >
        <div className={contentClassName}>{children}</div>
      </div>
    </li>
  );
}

// --- "Undo" bar for actions taken by swiping ---

type Undo = { message: string; undo?: { kind: "reopen" | "restore"; id: string } };
let undoListener: ((u: Undo) => void) | null = null;
export const showUndo = (u: Undo) => undoListener?.(u);

export function UndoBar() {
  const [current, setCurrent] = useState<(Undo & { key: number }) | null>(null);
  const reopen = useReopenTask();
  const restore = useRestore();

  useEffect(() => {
    undoListener = (u) => setCurrent({ ...u, key: Date.now() });
    return () => {
      undoListener = null;
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), 5000);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;
  const undo = current.undo;
  return (
    <div
      role="status"
      className="toast-in fixed inset-x-3 bottom-[calc(var(--tabbar-h)+0.75rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-xl bg-ink px-4 py-2.5 text-footnote text-white shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:w-80"
    >
      <span className="min-w-0 truncate">{current.message}</span>
      {undo && (
        <button
          type="button"
          onClick={() => {
            (undo.kind === "reopen" ? reopen : restore).mutate(undo.id);
            setCurrent(null);
          }}
          className="shrink-0 rounded-md px-2 py-1 font-semibold text-brand-200 uppercase active:scale-[0.97]"
        >
          Undo
        </button>
      )}
    </div>
  );
}
