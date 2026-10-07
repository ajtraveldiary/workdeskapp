import { Check } from "lucide-react";
import { cx } from "./ui";

// Picked from the name so a sender always gets the same colour. Uses in-between hues
// (pink, cyan, teal, indigo, grey) because the primary and secondary colours mean priority.
const TONES = [
  "bg-[#ffe0f0] text-[#c2185b] dark:bg-[#4a1730] dark:text-[#ff9fcd]", // pink
  "bg-[#d9f6fb] text-[#00838f] dark:bg-[#0f3a40] dark:text-[#7fe3ef]", // cyan
  "bg-[#d5f5ee] text-[#00796b] dark:bg-[#0f3a33] dark:text-[#7fe0cc]", // teal
  "bg-[#e3e5ff] text-[#3949ab] dark:bg-[#22264f] dark:text-[#aab3ff]", // indigo
  "bg-[#eef0f3] text-[#4b5563] dark:bg-[#3a3a3c] dark:text-[#d1d1d6]", // grey
];

function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 40,
  className,
  ring,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const tone = TONES[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % TONES.length];
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) };
  const cls = cx("shrink-0 rounded-full object-cover", ring && "ring-2 ring-white", className);
  if (src) return <img src={src} alt="" referrerPolicy="no-referrer" style={style} className={cls} />;
  return (
    <span style={style} className={cx(cls, "inline-flex items-center justify-center font-semibold", tone)} aria-hidden>
      {initials(name)}
    </span>
  );
}

// Email lists (user request 2026-10-06): the sender's picture (initials circle; Gmail doesn't give apps sender
// photos) takes the place of the tick box. Tapping it turns it into a ticked circle and selects the email;
// tapping again unticks it. It is a real checkbox for screen readers and keyboards.
export function SelectAvatar({
  name,
  selected,
  onToggle,
  label,
  size = 36,
}: {
  name: string;
  selected: boolean;
  onToggle: (selected: boolean) => void;
  label: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!selected);
      }}
      className="shrink-0 rounded-full transition-transform active:scale-90"
    >
      {selected ? (
        <span style={{ width: size, height: size }} className="flex animate-[pop_160ms_ease-out] items-center justify-center rounded-full bg-brand-600 text-white">
          <Check size={Math.round(size * 0.5)} strokeWidth={3} />
        </span>
      ) : (
        <Avatar name={name} size={size} />
      )}
    </button>
  );
}
