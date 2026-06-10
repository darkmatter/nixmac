/**
 * Unified telemetry provider interface.
 *
 * Replaces the separate AnalyticsProvider and Sentry init with a single
 * pipeline: OTEL spans for diagnostics, PostHog for product analytics.
 */

import type { TelemetryEvent } from "./events";

export type { TelemetryEvent } from "./events";

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
