import { AppFatalFallback } from "@/components/widget/layout/AppFatalFallback";
import { markBootStage } from "@/lib/boot-diagnostics";
import { isE2eProfile, nixmacEnvironment } from "@/lib/env";
import {
  bootstrapWithTelemetry,
  captureBootstrapRenderError,
} from "@/lib/telemetry/bootstrap";
import { initTelemetry } from "@/lib/telemetry/init";
import { TelemetryContextProvider } from "@/lib/telemetry/context";
import { getTelemetry, setTelemetryProvider } from "@/lib/telemetry/instance";
import { queryClient } from "@/lib/orpc";
import type { TelemetryProvider } from "@/lib/telemetry/types";
import { AppErrorBoundary } from "@/components/widget/layout/AppErrorBoundary";
import { queryPersistOptions } from "@/lib/query-persist";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
markBootStage("main-loaded");

if (!rootElement) {
  throw new Error("Root element not found");
}
markBootStage("root-found");

// Dropped from production, e2e harness
if (isE2eProfile) {
  void import("@/e2e/boot-harness").then((m) => m.attachBootHarness({ rootElement }));
}

if (import.meta.env.DEV) {
  void import("@/lib/dev-onboarding-reset");
}

const root = ReactDOM.createRoot(rootElement);

const renderApp = (telemetry: TelemetryProvider) => {
  markBootStage("react-render-start");
  root.render(
    <React.StrictMode>
      <AppErrorBoundary fallback={(error) => <AppFatalFallback error={error} />}>
        {queryPersistOptions ? (
          <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
            <TelemetryContextProvider value={telemetry}>
              <App />
            </TelemetryContextProvider>
          </PersistQueryClientProvider>
        ) : (
          <QueryClientProvider client={queryClient}>
            <TelemetryContextProvider value={telemetry}>
              <App />
            </TelemetryContextProvider>
          </QueryClientProvider>
        )}
      </AppErrorBoundary>
    </React.StrictMode>,
  );
  markBootStage("react-render-scheduled");
};

const bootstrap = async () => {
  try {
    await bootstrapWithTelemetry({
      initTelemetry,
      getTelemetry,
      setTelemetry: setTelemetryProvider,
      render: renderApp,
      environment: nixmacEnvironment,
      onTelemetryError: (phase, error) => {
        console.warn(`Telemetry ${phase} failed; continuing with app bootstrap.`, error);
      },
    });
  } catch (error) {
    markBootStage("react-render-fatal");
    captureBootstrapRenderError({
      error,
      getTelemetry,
      onTelemetryError: (_phase, reportingError) => {
        console.warn(
          "Telemetry render-error reporting failed; showing fatal fallback.",
          reportingError,
        );
      },
    });
    root.render(<AppFatalFallback error={error instanceof Error ? error : null} />);
  }
};

void bootstrap();
