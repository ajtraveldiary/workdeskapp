// WorkDesk's service worker (user request 2026-10-07: "enable offline viewing"). Built into dist/sw.js by the
// workdesk-service-worker plugin in vite.config.ts, which puts the build's version in VERSION (so each
// deploy installs a fresh copy). It keeps:
//  - the app itself (the page, its scripts and styles, fonts, icons), so WorkDesk opens with no internet;
//  - the last answer to each of the app's data requests (lists, emails opened before), served only when the
//    network can't be reached, marked with an "x-workdesk-offline" header so the app shows it is offline.
// Changes (POST/PATCH…), sign-in, attachments, the calendar feed and version checks always go to the network.
const VERSION = "__WORKDESK_VERSION__";
const SHELL = `workdesk-shell-${VERSION}`;
const DATA = "workdesk-data";
const DATA_LIMIT = 400; // saved data answers; the oldest go first

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        const res = await fetch("/", { cache: "no-store" });
        if (res.ok) {
          const html = await res.clone().text();
          await cache.put("/", res);
          const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
          await cache.addAll([...urls, "/manifest.webmanifest", "/icon-180.png", "/icon-192.png"]);
        }
      } catch {
        // offline while installing: the pages are saved as they are used instead
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("workdesk-shell-") && key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") event.respondWith(cacheFirst(req));
    return;
  }
  const path = url.pathname;
  if (path === "/version.json" || path === "/sw.js") return;
  if (path.startsWith("/api/")) {
    if (path.startsWith("/api/auth") || path.startsWith("/api/calendar/") || path.includes("/parts/")) return;
    event.respondWith(networkFirstData(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(req));
    return;
  }
  if (path.startsWith("/assets/") || path.startsWith("/fonts/") || /\.(png|webmanifest)$/.test(path)) event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  // ignoreVary: a saved file must match the page's request even if the server answered with "Vary" (e.g.
  // Origin, which module scripts send and the copies saved at install did not).
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") await cache.put(req, res.clone());
  return res;
}

// Every screen is the same page (the app picks the screen), saved as "/".
async function networkFirstPage(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put("/", res.clone());
    return res;
  } catch {
    return (await cache.match("/", { ignoreVary: true })) ?? Response.error();
  }
}

async function networkFirstData(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - DATA_LIMIT))) await cache.delete(old);
    }
    return res;
  } catch {
    const saved = await cache.match(req, { ignoreVary: true });
    if (!saved) return Response.error();
    const headers = new Headers(saved.headers);
    headers.set("x-workdesk-offline", "1");
    return new Response(saved.body, { status: saved.status, statusText: saved.statusText, headers });
  }
}

// --- Phone notifications (user request 2026-10-07) ---
// The server (src/server/lib/notify.ts) sends { title, body, url, tag, badge }. iPhone requires every push to
// show a notification, so one is always shown. badge is the number on the app icon (Home's "Pending today").
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const nav = self.navigator;
  const badge =
    typeof d.badge === "number" && nav && "setAppBadge" in nav ? (d.badge > 0 ? nav.setAppBadge(d.badge) : nav.clearAppBadge()).catch(() => undefined) : null;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(d.title || "WorkDesk", {
        body: d.body || "",
        tag: d.tag,
        data: { url: d.url || "/" },
        icon: "/icon-192.png",
        badge: "/icon-192.png",
      }),
      badge,
    ]),
  );
});

// Tapping a notification opens WorkDesk (the open window if there is one) at the notification's page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        if ("navigate" in w && w.url !== url) await w.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
