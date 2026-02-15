import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";
import { darwinAPI } from "@/tauri-api";

function FallbackComponent() {
  return <div>Something went wrong.</div>;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const initializeApp = async () => {
  const prefs = await darwinAPI.ui.getPrefs().catch(() => null);
  const sendDiagnostics = prefs?.sendDiagnostics ?? false;

  // Vite exposes environment variables at build time, so read the Sentry DSN and other config from there.
  const sentryDsn = (import.meta.env.VITE_SENTRY_DSN || "").toString().trim();
  const sentryEnabled = sendDiagnostics && sentryDsn.length > 0;

  const release = (import.meta.env.VITE_NIXMAC_VERSION || "unknown").toString();
  const environment = (
    import.meta.env.VITE_NIXMAC_ENV ||
    import.meta.env.MODE ||
    "prod"
  ).toString();
  if (sentryEnabled) {
    Sentry.init({
      dsn: sentryDsn,
      environment: environment,
      release: release,
      defaultIntegrations: false, // Disable default integrations to avoid issues in tauri
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
    });
    console.info("Sentry initialized.", {
      environment: environment,
      release: release,
    });
  } else {
    console.info("Sentry not enabled.");
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      {sentryEnabled ? (
        <Sentry.ErrorBoundary
          fallback={<FallbackComponent />}
          onError={(error, componentStack) => {
            console.error("ErrorBoundary caught:", error, componentStack);
          }}
        >
          <App />
        </Sentry.ErrorBoundary>
      ) : (
        <App />
      )}
    </React.StrictMode>,
  );
};

void initializeApp();
