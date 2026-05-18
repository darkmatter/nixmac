import { AppFatalFallback } from "@/components/widget/layout/AppFatalFallback";
import { markBootStage } from "@/lib/boot-diagnostics";
import { attachSentry, captureRenderError } from "@/lib/sentry/init";
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

const renderApp = () => {
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
        <App />
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
  markBootStage("react-render-scheduled");
};

const bootstrap = async () => {
  // Awaiting attachSentry blocks render in production,
  // in E2E_MODE resolves synchronously and the harness handles its own init lifecycle.
  await attachSentry();

  try {
    renderApp();
  } catch (error) {
    markBootStage("react-render-fatal");
    captureRenderError("render-fatal", error);
    root.render(
      <AppFatalFallback error={error instanceof Error ? error : null} />,
    );
  }
};

void bootstrap();
