// Session signing (HMAC-SHA256) and refresh-token encryption (AES-GCM) with Web Crypto,
// which is available in both Cloudflare Workers and Node.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signPayload(payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyPayload<T>(token: string, secret: string): Promise<T | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64(sig), enc.encode(body));
    return ok ? (JSON.parse(dec.decode(fromB64(body))) as T) : null;
  } catch {
    return null;
  }
}

async function aesKey(keyB64: string) {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64 encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(plain));
  return `${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string, keyB64: string): Promise<string> {
  const [iv, ct] = stored.split(".");
  if (!iv || !ct) throw new Error("Malformed encrypted value");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aesKey(keyB64), fromB64(ct));
  return dec.decode(pt);
}
