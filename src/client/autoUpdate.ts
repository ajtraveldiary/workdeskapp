// Keeps open copies of WorkDesk up to date (2026-10-06): home-screen apps on iPhones can keep running an old
// version for a long time, even after being reopened. When the app starts and whenever it comes back to the
// screen (at most once a minute), it asks for /version.json; if the server has a newer build, it reloads once.
const CHECK_EVERY = 60_000;
const RELOADED_FOR = "workdesk-reloaded-for";

let lastCheck = 0;

async function check() {
  if (Date.now() - lastCheck < CHECK_EVERY) return;
  lastCheck = Date.now();
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return; // e.g. the dev server, which has no version file
    const { version } = (await res.json()) as { version?: string };
    if (!version || version === __APP_VERSION__) return;
    // Reload only once per new version, so a slow cache can never cause a reload loop.
    if (sessionStorage.getItem(RELOADED_FOR) === version) return;
    sessionStorage.setItem(RELOADED_FOR, version);
    location.reload();
  } catch {
    // offline or storage blocked: try again next time
  }
}

export function startAutoUpdate() {
  void check();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void check());
  window.addEventListener("pageshow", () => void check());
}
