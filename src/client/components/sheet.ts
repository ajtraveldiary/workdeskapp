// App-style sheets on phones (user requests 2026-10-06): pull down to close (email viewer, forms, menus).
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

// True on phones (under 640px), where pop-ups become sheets from the bottom of the screen.
export function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

// Phones: pull a sheet down to close it (user request 2026-10-06). The pull starts anywhere on the sheet except
// inside a [data-sheet-scroll] area that is scrolled down (or an email's own HTML frame).
export const PHONE = "(max-width: 639.98px)";
export function usePullToClose(ref: RefObject<HTMLDialogElement | null>, onClose: () => void, open: boolean) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el || !open || !window.matchMedia(PHONE).matches) return;
    let state: "idle" | "maybe" | "drag" = "idle";
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dy = 0;
    const place = (y: number, animate: boolean) => {
      el.style.transition = animate ? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
      el.style.transform = y ? `translateY(${y}px)` : "";
    };
    const start = (e: TouchEvent) => {
      const target = e.target as Element;
      // Only touches on this sheet: a menu sheet opened from inside it handles its own.
      if (target.closest?.("dialog") !== el) return;
      const scroller = target.closest?.("[data-sheet-scroll]");
      if (e.touches.length !== 1 || (scroller && scroller.scrollTop > 0)) return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      startT = e.timeStamp;
      dy = 0;
      state = "maybe";
    };
    const move = (e: TouchEvent) => {
      if (state === "idle") return;
      const x = e.touches[0]!.clientX - startX;
      const y = e.touches[0]!.clientY - startY;
      if (state === "maybe") {
        // Sideways swipes and upward scrolls are left alone.
        if ((Math.abs(x) > 8 && Math.abs(x) > Math.abs(y)) || y < -4) return void (state = "idle");
        if (y < 8) return;
        state = "drag";
      }
      e.preventDefault();
      dy = Math.max(0, y);
      place(dy, false);
    };
    const end = (e: TouchEvent) => {
      if (state !== "drag") return void (state = "idle");
      state = "idle";
      const speed = dy / Math.max(1, e.timeStamp - startT);
      if (dy > 140 || (dy > 50 && speed > 0.6)) {
        place(el.offsetHeight, true);
        setTimeout(() => closeRef.current(), 200);
      } else place(0, true);
    };
    const cancel = () => {
      if (state === "drag") place(0, true);
      state = "idle";
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", cancel);
    };
  }, [ref, open]);
}

