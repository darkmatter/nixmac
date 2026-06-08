import { AppFatalFallback } from "@/components/widget/layout/AppFatalFallback";
import { markBootStage } from "@/lib/boot-diagnostics";
import { initTelemetry } from "@/lib/telemetry/init";
import { TelemetryContextProvider } from "@/lib/telemetry/context";
import { setTelemetryProvider } from "@/lib/telemetry/instance";
import type { TelemetryProvider } from "@/lib/telemetry/types";
import { captureRenderError, attachSentry } from "@/lib/sentry/init";
import * as Sentry from "@sentry/react";
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
if (import.meta.env.VITE_NIXMAC_E2E_MODE === "true") {
  void import("@/e2e/boot-harness").then((m) =>
    m.attachBootHarness({ rootElement }),
  );
}

const root = ReactDOM.createRoot(rootElement);

const renderApp = (telemetry: TelemetryProvider) => {
  markBootStage("react-render-start");
  root.render(
    <React.StrictMode>
      <Sentry.ErrorBoundary
        fallback={({ error }) => (
          <AppFatalFallback error={error instanceof Error ? error : null} />
        )}
        onError={(error, _componentStack) => {
          console.error("ErrorBoundary caught:", error);
          captureRenderError("render-error", error);
        }}
      >
        <TelemetryContextProvider value={telemetry}>
          <App />
        </TelemetryContextProvider>
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
  markBootStage("react-render-scheduled");
};

const bootstrap = async () => {
  // Init Sentry for ErrorBoundary + crash reporting (migrating to OTEL).
  // In E2E_MODE, attachSentry and initTelemetry return noop providers synchronously.
  const telemetry = await initTelemetry();
  await attachSentry();
  setTelemetryProvider(telemetry);
  telemetry.captureEvent({ name: "app_launched", props: { environment: (import.meta.env.VITE_NIXMAC_ENV || import.meta.env.MODE || "prod").toString() } });

  try {
    renderApp(telemetry);
  } catch (error) {
    markBootStage("react-render-fatal");
    captureRenderError("render-fatal", error);
    root.render(
      <AppFatalFallback error={error instanceof Error ? error : null} />,
    );
  }
};

void bootstrap();
