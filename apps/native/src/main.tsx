import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";
import { markBootStage } from "@/lib/boot-diagnostics";
import { attachSentry, captureRenderError } from "@/lib/sentry/init";
import { StartupFallback } from "@/components/StartupFallback";

const rootElement = document.getElementById("root");
markBootStage("main-loaded");

if (!rootElement) {
  throw new Error("Root element not found");
}
markBootStage("root-found");

// E2E build-only diagnostic harness: heartbeat, watchdog, DOM snapshots, window
// error listeners, post-render DOM probe. Statically dead code in production
// builds, so Vite drops the chunk from the bundle.
if (import.meta.env.VITE_NIXMAC_E2E_MODE === "true") {
  void import("@/e2e/boot-harness").then((m) => m.attachBootHarness({ rootElement }));
}

const root = ReactDOM.createRoot(rootElement);

const renderApp = () => {
  markBootStage("react-render-start");
  root.render(
    <React.StrictMode>
      <Sentry.ErrorBoundary
        fallback={<StartupFallback />}
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
  // Awaiting attachSentry blocks render in production until prefs are read
  // and Sentry has initialized or been skipped, so a render error can't fire
  // before Sentry is ready to receive it. In E2E builds attachSentry resolves
  // synchronously and the harness handles its own init lifecycle.
  await attachSentry();

  try {
    renderApp();
  } catch (error) {
    markBootStage("react-render-fatal");
    captureRenderError("render-fatal", error);
    root.render(<StartupFallback />);
  }
};

void bootstrap();
