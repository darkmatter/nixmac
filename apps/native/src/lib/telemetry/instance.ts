import type { TelemetryProvider } from "./types";
import { noopProvider } from "./noop";

/**
 * Module-level telemetry reference.
 *
 * Set once during bootstrap (main.tsx). This allows non-React code
 * (hooks, viewmodel functions, event handlers) to call telemetry
 * without needing React context.
 *
 * The React context (useTelemetry) remains the primary access path
 * for components. This module-level reference is for imperative code
 * that runs outside the component tree.
 */

let _provider: TelemetryProvider = noopProvider;

export function setTelemetryProvider(provider: TelemetryProvider): void {
  _provider = provider;
}

export function getTelemetry(): TelemetryProvider {
  return _provider;
}
