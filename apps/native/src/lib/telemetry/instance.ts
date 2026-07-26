import type { TelemetryProvider } from "./types";
import { noopProvider } from "./noop";

/**
 * Module-level telemetry reference.
 *
 * Set by the bootstrap deadline winner. This allows non-React code (hooks,
 * viewmodel functions, event handlers) to call the same provider React receives
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
