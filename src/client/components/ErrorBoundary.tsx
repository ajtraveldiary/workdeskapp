// If a screen crashes, show a way back instead of a blank page. The usual cause is data saved in this browser
// by an older version of WorkDesk, so the saved copy is cleared straight away and Reload starts fresh.
import { Component, type ReactNode } from "react";
import { clearSavedData } from "../queryClient";
import { Button } from "./ui";

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

// Page-level net (user request 2026-10-11): if one page crashes, only the page area shows this message; the
// menu, top bar and tab bar keep working. It sits inside the page area that is rebuilt on every page change
// (App.tsx), so opening another page clears it. The whole-app ErrorBoundary above stays as the last resort.
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
    // Same usual cause as above: data saved by an older version. Clear it so trying again starts fresh.
    void clearSavedData();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <p className="text-lg font-medium text-ink">This page hit a problem</p>
        <p className="max-w-xs text-sm text-slate-500">The rest of WorkDesk still works. Try again, or open another page.</p>
        <Button variant="primary" className="mt-2" onClick={() => clearSavedData().finally(() => this.setState({ failed: false }))}>
          Try again
        </Button>
      </div>
    );
  }
}
