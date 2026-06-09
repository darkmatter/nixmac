import type { TelemetryProvider } from "./types";

/**
 * No-op telemetry provider. Returned when:
 * - diagnostics/product analytics are disabled
 * - VITE_POSTHOG_KEY is missing
 * - E2E mode / Storybook / test environments
 *
 * Guarantees useTelemetry() is always safe to call.
 */
export const noopProvider: TelemetryProvider = {
  captureEvent() {},
  captureError() {},
  diagnosticsEnabled: false,
  productAnalyticsEnabled: false,
  reset() {},
  setDiagnosticsEnabled() {},
  setProductAnalyticsEnabled() {},
};
