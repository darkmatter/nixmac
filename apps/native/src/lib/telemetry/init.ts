import { tauriAPI } from "@/ipc/api";
import { createTelemetryProvider } from "./provider";
import { setTelemetryProvider } from "./instance";
import { noopProvider } from "./noop";
import type { TelemetryProvider } from "./types";

const E2E_MODE = import.meta.env.VITE_NIXMAC_E2E_MODE === "true";

/**
 * Bootstrap the unified telemetry provider for this session.
 *
 * Replaces the legacy Sentry init and analytics setup: one pipeline that mirrors
 * product events to PostHog (direct) and routes events/errors through OTEL into
 * the Rust backend.
 *
 * Behavior:
 * - E2E mode → noop (no telemetry, no PostHog).
 * - Build-time config (key/host/release/environment) read from Vite env.
 * - Product capture is gated on productAnalyticsEnabled.
 * - Diagnostics/error reporting is gated on sendDiagnostics.
 * - Installs the provider via setTelemetryProvider() for non-React callers.
 */
export async function initTelemetry(): Promise<TelemetryProvider> {
  if (E2E_MODE) {
    setTelemetryProvider(noopProvider);
    return noopProvider;
  }

  const key = (import.meta.env.VITE_POSTHOG_KEY || "").toString().trim();
  const host = (
    import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com"
  )
    .toString()
    .trim();

  if (key.length === 0) {
    setTelemetryProvider(noopProvider);
    return noopProvider;
  }

  let productAnalyticsEnabled = true;
  let sendDiagnostics = false;
  try {
    const prefs = await tauriAPI.ui.getPrefs();
    productAnalyticsEnabled = prefs?.productAnalyticsEnabled ?? true;
    sendDiagnostics = prefs?.sendDiagnostics ?? false;
  } catch {
    // If prefs are unreadable, do not risk overriding a persisted opt-out.
    productAnalyticsEnabled = false;
    sendDiagnostics = false;
  }

  const provider = createTelemetryProvider(
    {
      key,
      host,
      release: (import.meta.env.VITE_NIXMAC_VERSION || "unknown").toString(),
      environment: (
        import.meta.env.VITE_NIXMAC_ENV ||
        import.meta.env.MODE ||
        "prod"
      ).toString(),
    },
    {
      diagnosticsEnabled: sendDiagnostics,
      productAnalyticsEnabled,
    },
  );

  setTelemetryProvider(provider);
  return provider;
}
