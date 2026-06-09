/**
 * Unified telemetry provider interface.
 *
 * Replaces the separate AnalyticsProvider and Sentry init with a single
 * pipeline: OTEL spans for diagnostics, PostHog for product analytics.
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
    props: { step: string };
  }
  | {
    name: "evolve_failed";
    props?: { stage: "build" | "agent" | "apply" };
  }
  | { name: "rollback_performed" }
  | { name: "settings_changed"; props: { setting: string } }
  | { name: "diagnostics_opt_in" }
  | { name: "diagnostics_opt_out" }
  | { name: "product_analytics_opt_in" }
  | { name: "product_analytics_opt_out" };

export interface TelemetryProvider {
  /** Record a product event. Goes only to PostHog and is product-consent gated. */
  captureEvent(event: TelemetryEvent): void;
  /** Record a diagnostics-gated error span. */
  captureError(error: Error, context?: Record<string, unknown>): void;
  /** Turn diagnostics/error reporting on/off at runtime. */
  setDiagnosticsEnabled(enabled: boolean): void;
  /** Turn product analytics on/off at runtime. */
  setProductAnalyticsEnabled(enabled: boolean): void;
  /** Whether diagnostics/error reporting is currently active. */
  readonly diagnosticsEnabled: boolean;
  /** Whether product analytics capture is currently active. */
  readonly productAnalyticsEnabled: boolean;
  /** Clear identity / queued state. */
  reset(): void;
}
