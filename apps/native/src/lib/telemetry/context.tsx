import { createContext, useContext } from "react";
import type { TelemetryProvider } from "./types";
import { noopProvider } from "./noop";

const TelemetryCtx = createContext<TelemetryProvider>(noopProvider);

/**
 * Provider component that makes the telemetry instance available
 * to the component tree via useTelemetry().
 *
 * Place inside the AppErrorBoundary so telemetry never
 * interferes with crash capture.
 */
export function TelemetryContextProvider({
  value,
  children,
}: {
  value: TelemetryProvider;
  children: React.ReactNode;
}) {
  return (
    <TelemetryCtx.Provider value={value}>{children}</TelemetryCtx.Provider>
  );
}

/**
 * Hook to access the telemetry provider.
 * Safe to call anywhere — returns noopProvider outside the provider tree
 * (tests, Storybook, etc.).
 */
export function useTelemetry(): TelemetryProvider {
  return useContext(TelemetryCtx);
}
