import { cx } from "./ui";

// Pastel tones from Google's extended palette, picked from the name so a sender always gets the same colour.
// Red, yellow, blue and green are left out: those mean priority.
const TONES = [
  "bg-[#f3e8fd] text-[#8430ce]", // purple
  "bg-[#fde7f3] text-[#b80672]", // pink
  "bg-[#e4f7fb] text-[#007b83]", // cyan
  "bg-[#feefe3] text-[#c26401]", // orange
  "bg-[#f1f3f4] text-[#5f6368]", // grey
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
