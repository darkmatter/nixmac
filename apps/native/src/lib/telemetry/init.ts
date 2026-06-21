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
 * - Gated on the sendDiagnostics pref, fail-closed if prefs can't be read.
 * - Installs the provider via setTelemetryProvider() for non-React callers.
 */
export async function initTelemetry(): Promise<TelemetryProvider> {
  if (E2E_MODE) {
    setTelemetryProvider(noopProvider);
    return noopProvider;
  }

  const key = (import.meta.env.VITE_POSTHOG_KEY || "").toString().trim();
  const host = (import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com").toString().trim();

  if (key.length === 0) {
    setTelemetryProvider(noopProvider);
    return noopProvider;
  }

  let sendDiagnostics = false;
  try {
    const prefs = await tauriAPI.ui.getPrefs();
    sendDiagnostics = prefs?.sendDiagnostics ?? false;
  } catch {
    // fail closed — no telemetry if we can't read prefs
  }

  const provider = createTelemetryProvider(
    {
      key,
      host,
      release: (import.meta.env.VITE_NIXMAC_VERSION || "unknown").toString(),
      environment: (import.meta.env.VITE_NIXMAC_ENV || import.meta.env.MODE || "prod").toString(),
    },
    sendDiagnostics,
  );

  setTelemetryProvider(provider);
  return provider;
}
