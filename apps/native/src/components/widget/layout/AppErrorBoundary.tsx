import { Component, type ErrorInfo, type ReactNode } from "react";
import { AppFatalFallback } from "@/components/widget/layout/AppFatalFallback";
import { getTelemetry } from "@/lib/telemetry/instance";

type AppErrorBoundaryProps = {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

/**
 * Top-level error boundary for the app. Replaces the previous
 * Sentry.ErrorBoundary: render errors are logged and routed through the
 * unified telemetry pipeline (OTEL → Rust backend) via getTelemetry().
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error("AppErrorBoundary caught:", error);
    getTelemetry().captureError(error, { name: "render-error" });
  }

  render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback ? (
        this.props.fallback(error)
      ) : (
        <AppFatalFallback error={error} />
      );
    }
    return this.props.children;
  }
}
