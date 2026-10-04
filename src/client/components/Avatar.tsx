import { cx } from "./ui";

// Soft background tones, picked from the name so a sender always gets the same colour.
const TONES = [
  "bg-[#e3f5ea] text-[#2f875a]",
  "bg-[#ece7fe] text-[#6b51d8]",
  "bg-[#fdeedd] text-[#b4651c]",
  "bg-[#e2effd] text-[#2f6fb8]",
  "bg-[#fde6ea] text-[#b8405a]",
  "bg-[#e9ecf1] text-[#4b5263]",
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
