// A panel that slides in from the right edge of the phone (user request 2026-10-07: the Account menu opens "as
// a side panel from that side", where the profile picture is). A tap outside, the ✕ or a swipe to the right
// closes it. Used on phones only; wider screens keep their drop-downs.
import { useEffect, useRef, type ReactNode } from "react";

export function SidePanel({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.setAttribute("autofocus", ""); // focus the panel, not its first link
      d.showModal();
    }
    return () => d?.close();
  }, []);

  // Swipe right to close: the panel follows the finger and closes past a third of its width.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let dragging = false;
    const start = (e: TouchEvent) => {
      x0 = e.touches[0]!.clientX;
      y0 = e.touches[0]!.clientY;
      dx = 0;
      dragging = false;
    };
    const move = (e: TouchEvent) => {
      const mx = e.touches[0]!.clientX - x0;
      const my = e.touches[0]!.clientY - y0;
      if (!dragging && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) dragging = mx > 0;
      if (!dragging) return;
      dx = Math.max(0, mx);
      d.style.transition = "none";
      d.style.transform = `translateX(${dx}px)`;
    };
    const end = () => {
      if (!dragging) return;
      d.style.transition = "transform 200ms ease-out";
      if (dx > d.offsetWidth / 3) onClose();
      else d.style.transform = "";
      dragging = false;
    };
    d.addEventListener("touchstart", start, { passive: true });
    d.addEventListener("touchmove", move, { passive: true });
    d.addEventListener("touchend", end);
    return () => {
      d.removeEventListener("touchstart", start);
      d.removeEventListener("touchmove", move);
      d.removeEventListener("touchend", end);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={(e) => {
        e.stopPropagation();
        if (!e.currentTarget.open) onClose();
      }}
      // The dialog itself is only hit outside the panel (the dimmed area).
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="side-panel fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none bg-white p-0 text-ink shadow-2xl outline-none"
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]">{children}</div>
    </dialog>
  );
}
