import { tauriAPI } from "@/ipc/api";
import { isE2eProfile, nixmacEnvironment, nixmacVersion, settings } from "@/lib/env";
import { createTelemetryProvider } from "./provider";
import { noopProvider } from "./noop";
import type { TelemetryProvider } from "./types";

const E2E_MODE = isE2eProfile;

/**
 * Bootstrap the unified telemetry provider for this session.
 *
 * Replaces the legacy Sentry init and analytics setup: one pipeline that mirrors
 * product events to PostHog (direct) and routes events/errors through OTEL into
 * the Rust backend.
 *
 * Behavior:
 * - E2E mode → noop (no telemetry, no PostHog).
 * - Build-time config from committed env profiles; PostHog key/host overridable via process env at build.
 * - Gated on the sendDiagnostics pref, fail-closed if prefs can't be read.
 * Provider installation is owned by the bootstrap deadline winner so a late
 * initialization cannot replace the provider already handed to React.
 */
export async function initTelemetry(): Promise<TelemetryProvider> {
  if (E2E_MODE) {
    return noopProvider;
  }

  const key = (settings.posthogKey || "").trim();
  const host = settings.posthogHost.trim();

  if (key.length === 0) {
    return noopProvider;
  }

  let sendDiagnostics = false;
  try {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    const prefs = await tauriAPI.ui.getPrefs();
    sendDiagnostics = prefs?.sendDiagnostics ?? false;
  } catch {
    // fail closed — no telemetry if we can't read prefs
  }

  const provider = createTelemetryProvider(
    {
      key,
      host,
      release: nixmacVersion,
      environment: nixmacEnvironment,
    },
    sendDiagnostics,
  );

  return provider;
}
