import type { TelemetryProvider } from "./types";

/**
 * No-op telemetry provider. Returned when:
 * - sendDiagnostics is false
 * - VITE_POSTHOG_KEY is missing
 * - E2E mode / Storybook / test environments
 *
 * Guarantees useTelemetry() is always safe to call —
 * call sites never branch on enabled-ness.
 */
export const noopProvider: TelemetryProvider = {
  enabled: false,
  captureEvent() {},
  captureError() {},
  setEnabled() {},
  reset() {},
};
