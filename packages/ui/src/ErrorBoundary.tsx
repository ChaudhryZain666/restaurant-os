import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button.js";
import { Card } from "./Card.js";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown above the recovery actions — keep it short, this is a "something broke" screen, not a
   *  debugging surface (the real error is still logged to the console via onError/componentDidCatch). */
  title?: string;
  description?: string;
  /** Called with the caught error — wire this to real error reporting later; today it just logs. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * React only supports catching render-time exceptions via a class component (no hook
 * equivalent exists) — this is the one place in either frontend app's component tree allowed to
 * be a class for that reason. Without this mounted near the app root, any uncaught render error
 * (a malformed API response reaching a field that isn't optional, a bad third-party render, ...)
 * unmounts the entire React tree to a blank white page with no recovery affordance.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="font-heading text-lg font-semibold text-foreground">
            {this.props.title ?? "Something went wrong"}
          </p>
          <p className="text-sm text-muted">
            {this.props.description ??
              "This page hit an unexpected error. Reloading usually fixes it — if it keeps happening, please contact support."}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => (window.location.href = "/")}>
              Go home
            </Button>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </Card>
      </div>
    );
  }
}
