// Web Push (user request 2026-10-07: phone notifications for the iPhone home-screen app). Sends a notification
// to a browser's push service (Apple's for iPhone, Google's / Mozilla's for others) with only WebCrypto, so it
// runs on Cloudflare Workers: the message is encrypted for the device (RFC 8291, aes128gcm) and signed with
// WorkDesk's own key pair (VAPID, RFC 8292), which is made on first use and kept in the users table.

const enc = new TextEncoder();

export const b64url = (bytes: Uint8Array<ArrayBuffer>) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array<ArrayBuffer>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// --- VAPID key pair ---

export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

export async function makeVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { publicKey: b64url(raw), privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey };
}

// The "vapid t=…, k=…" Authorization header for one push service (aud = its origin), valid for 12 hours.
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...keys.privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

// --- Message encryption (RFC 8291) ---

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

// salt and serverKeys are only passed by tests (RFC 8291's worked example); normally both are fresh each time.
export async function encryptPayload(
  payload: Uint8Array<ArrayBuffer>,
  target: Pick<PushTarget, "p256dh" | "auth">,
  test?: { salt: Uint8Array<ArrayBuffer>; serverKeys: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  const server = test?.serverKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", server.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = test?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// What the service worker shows (src/sw/sw.js). badge: the number on the app icon.
export type PushMessage = { title: string; body: string; url: string; tag?: string; badge?: number };

// Sends one message to one device. "gone" means the device turned notifications off (or the app was
// removed): the subscription should be deleted.
export async function sendPush(target: PushTarget, message: PushMessage, keys: VapidKeys, subject: string, ttlSeconds = 6 * 3600): Promise<"ok" | "gone" | "failed"> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), target);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(target.endpoint, keys, subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttlSeconds),
      urgency: "high",
      ...(message.tag ? { topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) {
    console.error(`Push to ${new URL(target.endpoint).host} failed: ${res.status} ${await res.text().catch(() => "")}`);
    return "failed";
  }
  return "ok";
}
