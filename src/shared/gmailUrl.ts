export function gmailThreadUrl(accountEmail: string | null, gmailThreadId: string): string | null {
  if (!accountEmail || gmailThreadId.startsWith("demo-")) return null;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${gmailThreadId}`;
}
