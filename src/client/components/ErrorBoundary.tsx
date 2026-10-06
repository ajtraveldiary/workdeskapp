// If a screen crashes, show a way back instead of a blank page. The usual cause is data saved in this browser
// by an older version of WorkDesk, so the saved copy is cleared straight away and Reload starts fresh.
import { Component, type ReactNode } from "react";
import { clearSavedData } from "../queryClient";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
    void clearSavedData();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-medium text-ink">Something went wrong</p>
        <p className="max-w-xs text-sm text-slate-500">WorkDesk hit a problem showing this screen. Reloading usually fixes it.</p>
        <button
          onClick={() => clearSavedData().finally(() => location.assign("/"))}
          className="mt-2 h-10 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white active:scale-[0.97]"
        >
          Reload WorkDesk
        </button>
      </div>
    );
  }
}
