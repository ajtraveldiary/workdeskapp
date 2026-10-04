// Gmail access for WorkDesk. READ-ONLY BY CONSTRUCTION:
//  - The OAuth scope requested is gmail.readonly, so Google itself refuses any change.
//  - This module can only issue HTTP GET requests, and only to the read endpoints listed in
//    READ_PATHS. There is no code path that deletes, trashes, archives, labels, marks read,
//    or sends anything. tests/gmail-safety.test.ts fails the build if such code appears.

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const READ_PATHS = [/^\/profile$/, /^\/messages$/, /^\/threads\/[\w-]+$/, /^\/history$/];

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function gmailGet<T>(accessToken: string, path: string, params: Record<string, string | string[]> = {}) {
  if (!READ_PATHS.some((re) => re.test(path))) throw new Error(`Blocked non-read Gmail path: ${path}`);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const item of [v].flat()) qs.append(k, item);
  const res = await fetch(`${GMAIL}${path}?${qs}`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new GmailError(`Gmail ${path} failed: ${res.status} ${await res.text()}`, res.status);
  return (await res.json()) as T;
}

export type GmailHeader = { name: string; value: string };
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};

export const getProfile = (token: string) =>
  gmailGet<{ emailAddress: string; historyId: string }>(token, "/profile");

export const listMessages = (token: string, q: string, pageToken?: string) =>
  gmailGet<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(token, "/messages", {
    q,
    maxResults: "100",
    ...(pageToken ? { pageToken } : {}),
  });

export const getThread = (token: string, threadId: string) =>
  gmailGet<{ id: string; messages?: GmailMessage[] }>(token, `/threads/${threadId}`, {
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Date"],
  });

export const listHistory = (token: string, startHistoryId: string, pageToken?: string) =>
  gmailGet<{
    history?: { messages?: { id: string; threadId: string }[] }[];
    historyId: string;
    nextPageToken?: string;
  }>(token, "/history", {
    startHistoryId,
    labelId: "INBOX",
    historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
    ...(pageToken ? { pageToken } : {}),
  });

// --- OAuth (Google's token endpoint, not the Gmail API) ---

export function authUrl(clientId: string, redirectUri: string, state: string, loginHint?: string) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; id_token?: string; scope?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new GmailError(`Google token request failed: ${res.status} ${await res.text()}`, res.status);
  return (await res.json()) as TokenResponse;
}

export const exchangeCode = (clientId: string, clientSecret: string, code: string, redirectUri: string) =>
  tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

export const refreshAccessToken = (clientId: string, clientSecret: string, refreshToken: string) =>
  tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

// The id_token comes straight from Google's token endpoint over TLS, so its claims can be read directly.
export function idTokenClaims(idToken: string): { email?: string; email_verified?: boolean; name?: string; picture?: string } {
  const part = idToken.split(".")[1] ?? "";
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
}

// --- Parsing helpers ---

export function header(msg: GmailMessage, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

export function parseFrom(value: string): { name: string | null; email: string | null } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2]?.trim() || null };
  const email = value.trim();
  return { name: null, email: email || null };
}
