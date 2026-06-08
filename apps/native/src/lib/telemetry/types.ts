/**
 * Unified telemetry provider interface.
 *
 * Replaces the separate AnalyticsProvider and Sentry init with a single
 * pipeline: OTEL traces for error/crash reporting, PostHog for product analytics.
 */

export type TelemetryEvent =
  | { name: "app_launched"; props?: { environment: string } }
  | { name: "app_ready"; props?: { boot_ms?: number } }
  | {
      name: "evolve_started";
      props?: { provider: string; has_custom_model: boolean };
    }
  | {
      name: "evolve_completed";
      props: { outcome: "applied" | "committed" | "discarded" };
    }
  | {
      name: "evolve_failed";
      props?: { stage: "build" | "agent" | "apply" };
    }
  | { name: "rollback_performed" }
  | { name: "settings_changed"; props: { setting: string } }
  | { name: "diagnostics_opt_in" }
  | { name: "diagnostics_opt_out" };

export interface TelemetryProvider {
  /** Record a product event (goes to PostHog + OTEL span). */
  captureEvent(event: TelemetryEvent): void;
  /** Record an error (goes to OTEL → Sentry). */
  captureError(error: Error, context?: Record<string, unknown>): void;
  /** Turn telemetry on/off at runtime. */
  setEnabled(enabled: boolean): void;
  /** Whether telemetry is currently active. */
  readonly enabled: boolean;
  /** Clear identity / queued state. */
  reset(): void;
}
