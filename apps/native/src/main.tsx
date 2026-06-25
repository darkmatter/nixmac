import { AppFatalFallback } from "@/components/widget/layout/AppFatalFallback";
import { markBootStage } from "@/lib/boot-diagnostics";
import { isE2eProfile, nixmacEnvironment } from "@/lib/env";
import { initTelemetry } from "@/lib/telemetry/init";
import { TelemetryContextProvider } from "@/lib/telemetry/context";
import { getTelemetry, setTelemetryProvider } from "@/lib/telemetry/instance";
import type { TelemetryProvider } from "@/lib/telemetry/types";
import { AppErrorBoundary } from "@/components/widget/layout/AppErrorBoundary";
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
        <TelemetryContextProvider value={telemetry}>
          <App />
        </TelemetryContextProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
  markBootStage("react-render-scheduled");
};

const bootstrap = async () => {
  // In E2E_MODE, initTelemetry returns a noop provider synchronously.
  const telemetry = await initTelemetry();
  setTelemetryProvider(telemetry);
  telemetry.captureEvent({
    name: "app_launched",
    props: {
      environment: nixmacEnvironment,
    },
  });

  try {
    renderApp(telemetry);
  } catch (error) {
    markBootStage("react-render-fatal");
    getTelemetry().captureError(error instanceof Error ? error : new Error(String(error)), {
      name: "render-fatal",
    });
    root.render(<AppFatalFallback error={error instanceof Error ? error : null} />);
  }
};

void bootstrap();
