// Drag and drop to arrange a list (user request 2026-10-08: "always use drag and drop to arrange order of a
// list, instead of up and down arrows"). Each row starts with a grip handle: press it and drag (mouse, pen or
// finger; HTML5 drag and drop doesn't work on iPhone, so this uses pointer events), the other rows make room,
// and letting go calls `onReorder` with the ids in their new order. Near the top or bottom of the scrolling area
// the page scrolls along. Keyboard: focus the grip and press ↑ / ↓. Esc while dragging puts the row back.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cx } from "./ui";

type Drag = { id: string; from: number; to: number; dy: number };

// The nearest ancestor that scrolls (`<main>` in the app shell), else the page.
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  label,
  children,
  className,
  rowClassName,
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  /** Names a row for the grip's label, e.g. "Senior Clerk". */
  label: (item: T) => string;
  /** The row's content, to the right of the grip. */
  children: (item: T) => ReactNode;
  className?: string;
  rowClassName?: string;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const grips = useRef(new Map<string, HTMLButtonElement>());
  const live = useRef<{
    id: string;
    from: number;
    startY: number;
    startScroll: number;
    clientY: number;
    mids: number[];
    height: number;
    top: number;
    listTop: number;
    listBottom: number;
    scroller: HTMLElement | null;
    raf: number;
    to: number;
  } | null>(null);
  const refocus = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  // Keeps keyboard focus on the moved row's grip.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    grips.current.get(refocus.current)?.focus();
    refocus.current = null;
  });

  const scrollTop = (s: HTMLElement | null) => (s ? s.scrollTop : window.scrollY);

  // Where the dragged row would land, from the pointer and the scroll position.
  const update = () => {
    const l = live.current;
    if (!l) return;
    // The row follows the pointer but stays within the list (the box around it clips anything outside).
    const dy = Math.min(l.listBottom - l.top - l.height, Math.max(l.listTop - l.top, l.clientY - l.startY + (scrollTop(l.scroller) - l.startScroll)));
    // The leading edge decides (rows differ in height: a long Malayalam name wraps): going down, the row's bottom
    // passes the middle of the next one; going up, its top passes the middle of the one above.
    let to = l.from;
    if (dy > 0) while (to < l.mids.length - 1 && l.top + l.height + dy > l.mids[to + 1]!) to++;
    if (dy < 0) while (to > 0 && l.top + dy < l.mids[to - 1]!) to--;
    l.to = to;
    setDrag({ id: l.id, from: l.from, to, dy });
  };

  // Scrolls while the pointer is near the top or bottom edge of the scrolling area, as long as the list goes on
  // past that edge.
  const autoScroll = () => {
    const l = live.current;
    if (!l) return;
    const box = l.scroller ? l.scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const ul = list.current?.getBoundingClientRect();
    const edge = 56;
    const up = l.clientY < box.top + edge && !!ul && ul.top < box.top;
    const down = l.clientY > box.bottom - edge && !!ul && ul.bottom > box.bottom;
    const speed = up ? -Math.ceil((box.top + edge - l.clientY) / 4) : down ? Math.ceil((l.clientY - (box.bottom - edge)) / 4) : 0;
    if (speed) {
      if (l.scroller) l.scroller.scrollTop += speed;
      else window.scrollBy(0, speed);
      update();
    }
    l.raf = requestAnimationFrame(autoScroll);
  };

  const finish = (save: boolean) => {
    const l = live.current;
    if (!l) return;
    cancelAnimationFrame(l.raf);
    live.current = null;
    setDrag(null);
    if (save && l.to !== l.from) {
      const ids = items.map((x) => x.id);
      const [moved] = ids.splice(l.from, 1);
      ids.splice(l.to, 0, moved!);
      onReorder(ids);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 0 || live.current) return;
    e.preventDefault();
    const from = items.findIndex((x) => x.id === id);
    const el = rows.current.get(id);
    if (from < 0 || !el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const scroller = scrollParent(el);
    const startScroll = scrollTop(scroller);
    const mids = items.map((x) => {
      const r = rows.current.get(x.id)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : 0;
    });
    const r = el.getBoundingClientRect();
    const ul = list.current!.getBoundingClientRect();
    live.current = { id, from, to: from, startY: e.clientY, clientY: e.clientY, startScroll, mids, height: r.height, top: r.top, listTop: ul.top, listBottom: ul.bottom, scroller, raf: 0 };
    setDrag({ id, from, to: from, dy: 0 });
    live.current.raf = requestAnimationFrame(autoScroll);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!live.current) return;
    live.current.clientY = e.clientY;
    update();
  };

  // Esc puts the row back; leaving the page mid-drag does too.
  useEffect(() => {
    if (!drag) return;
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && finish(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });
  useEffect(() => () => cancelAnimationFrame(live.current?.raf ?? 0), []);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!by) return;
    e.preventDefault();
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const ids = items.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    refocus.current = ids[j]!;
    onReorder(ids);
  };

  // How far each other row moves to make room.
  const shift = (i: number) => {
    if (!drag || drag.from === drag.to) return 0;
    const h = live.current?.height ?? 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return h;
    return 0;
  };

  return (
    <ul ref={list} className={cx("divide-y divide-line", className)} role="list">
      {items.map((item, i) => {
        const dragging = drag?.id === item.id;
        const y = dragging ? drag.dy : shift(i);
        return (
          <li
            key={item.id}
            ref={(el) => void (el ? rows.current.set(item.id, el) : rows.current.delete(item.id))}
            style={y ? { transform: `translateY(${y}px)` } : undefined}
            className={cx(
              "relative flex items-center gap-2 bg-white",
              dragging ? "z-10 shadow-lg ring-1 ring-line" : drag ? "transition-transform duration-150" : "",
              rowClassName,
            )}
          >
            <button
              type="button"
              ref={(el) => {
                if (!el) return void grips.current.delete(item.id);
                grips.current.set(item.id, el);
                // Keeps pull-to-refresh (a touch listener on <main>) out of the drag.
                if (!el.dataset.sortable) {
                  el.dataset.sortable = "1";
                  el.addEventListener("touchstart", (ev) => ev.stopPropagation(), { passive: true });
                  el.addEventListener("touchmove", (ev) => ev.stopPropagation(), { passive: true });
                }
              }}
              aria-label={`Drag to move ${label(item)}. Arrow keys move it up or down.`}
              title="Drag to move"
              onPointerDown={(e) => onPointerDown(e, item.id)}
              onPointerMove={onPointerMove}
              onPointerUp={() => finish(true)}
              onPointerCancel={() => finish(false)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onContextMenu={(e) => e.preventDefault()}
              className={cx(
                "shrink-0 touch-none rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink active:scale-90",
                dragging ? "cursor-grabbing text-brand-700" : "cursor-grab",
              )}
            >
              <GripVertical size={16} />
            </button>
            {children(item)}
          </li>
        );
      })}
    </ul>
  );
}
