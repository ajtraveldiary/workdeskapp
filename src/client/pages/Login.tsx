import { CalendarCheck, ShieldCheck } from "lucide-react";

export function LoginPage() {
  const error = new URLSearchParams(location.search).get("auth_error");
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-brand-700 text-white">
            <CalendarCheck size={18} />
          </span>
          <span className="text-xl font-semibold tracking-tight">WorkDesk</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">Every email accounted for. Every task tracked.</p>
        {error && <p className="mt-4 rounded-md bg-urgent-soft px-3 py-2 text-sm text-urgent-ink">{error}</p>}
        <a
          href="/api/auth/google"
          className="mt-5 flex h-10 w-full items-center justify-center rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800"
        >
          Sign in with Google
        </a>
        <p className="mt-4 flex gap-2 text-xs text-slate-500">
          <ShieldCheck size={16} className="shrink-0 text-brand-700" />
          WorkDesk reads your Gmail and marks emails read when you open them here. It cannot delete, archive, label or send email.
        </p>
      </div>
    </div>
  );
}
