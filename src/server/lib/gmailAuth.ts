import type { gmailAccounts } from "../db/schema";
import type { Env } from "../env";
import { requireEnv } from "../env";
import { decryptSecret } from "./crypto";
import { refreshAccessToken } from "./gmail";

// Access tokens last about an hour; keep one per account in memory (per server instance, best effort)
// so opening several emails doesn't ask Google for a new token each time.
const cache = new Map<string, { token: string; expires: number }>();
const LIFETIME = 50 * 60_000;

export async function accessTokenFor(env: Env, account: typeof gmailAccounts.$inferSelect): Promise<string> {
  const hit = cache.get(account.id);
  if (hit && hit.expires > Date.now()) return hit.token;
  if (!account.refreshTokenEnc) throw new Error("Gmail account is not connected");
  const refresh = await decryptSecret(account.refreshTokenEnc, requireEnv(env, "TOKEN_ENC_KEY"));
  const { access_token } = await refreshAccessToken(requireEnv(env, "GOOGLE_CLIENT_ID"), requireEnv(env, "GOOGLE_CLIENT_SECRET"), refresh);
  cache.set(account.id, { token: access_token, expires: Date.now() + LIFETIME });
  return access_token;
}
