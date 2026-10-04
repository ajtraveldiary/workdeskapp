import { cx } from "./ui";

// Picked from the name so a sender always gets the same colour. Uses in-between hues
// (pink, cyan, teal, indigo, grey) because the primary and secondary colours mean priority.
const TONES = [
  "bg-[#ffe0f0] text-[#c2185b]", // pink
  "bg-[#d9f6fb] text-[#00838f]", // cyan
  "bg-[#d5f5ee] text-[#00796b]", // teal
  "bg-[#e3e5ff] text-[#3949ab]", // indigo
  "bg-[#eef0f3] text-[#4b5563]", // grey
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
