// Phone notifications on this device (user request 2026-10-07). On iPhone they only work in WorkDesk opened
// from the Home Screen icon (iOS 16.4 or newer); computers and Android browsers work in the browser too.
// The service worker (src/sw/sw.js) shows them; the server decides when (src/server/lib/notify.ts).
import { pushApi } from "./api";

export type PushState = "on" | "off" | "denied" | "needs-home-screen" | "unsupported";

const isIos = () => /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !standalone()) return "needs-home-screen";
  if (!("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const reg = await registration();
  if (!reg) return "unsupported"; // e.g. development, where the service worker isn't installed
  if (Notification.permission === "denied") return "denied";
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

const toBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
const deviceName = () => (isIos() ? (/iPad/.test(navigator.userAgent) ? "iPad" : "iPhone") : /Android/.test(navigator.userAgent) ? "Android" : /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows" : "Browser");

async function save(sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await pushApi.subscribe({ endpoint: json.endpoint, keys: json.keys, device: deviceName() });
}

// Must run straight from a tap (iPhone only asks for permission then).
export async function turnOnPush(publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) }));
  await save(sub);
  return "on";
}

export async function turnOffPush(): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await pushApi.unsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
  void navigator.clearAppBadge?.().catch(() => undefined);
}

export async function thisDeviceEndpoint() {
  return (await (await registration())?.pushManager.getSubscription())?.endpoint;
}

// When the app opens: tell the server about this device's subscription again (it may have been renewed, or
// forgotten after a failed send).
export async function refreshPushSubscription() {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) await save(sub);
  } catch {
    // offline or not signed in: next time
  }
}

// The red number on the app icon: Home's "Pending today" (due today + overdue). Only with notifications
// allowed (iPhone shows badges only then).
export function setIconBadge(n: number) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !("setAppBadge" in navigator)) return;
  void (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => undefined);
}
