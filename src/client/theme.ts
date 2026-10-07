// Dark mode (user request 2026-10-07). The choice is kept on this device (it is about the screen, not the
// data): Automatic follows the phone or computer's own Light/Dark setting, or pick Light or Dark. The
// `dark` class on <html> switches the colours (styles.css); index.html sets it before the page first draws,
// so a dark screen never flashes white on start-up.
export type ThemeChoice = "auto" | "light" | "dark";
const KEY = "workdesk-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function themeChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(choice = themeChoice()) {
  const dark = choice === "dark" || (choice === "auto" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "auto") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // No storage (private window): the choice lasts until the app is closed.
  }
  applyTheme(choice);
  listeners.forEach((l) => l(choice));
}

const listeners = new Set<(c: ThemeChoice) => void>();
export function onThemeChoice(l: (c: ThemeChoice) => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

// Automatic follows the device when it switches (e.g. iPhone's dark mode at sunset).
export function watchSystemTheme() {
  media().addEventListener("change", () => applyTheme());
}
