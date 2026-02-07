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
  const sentryDsn = (import.meta.env.VITE_SENTRY_DSN || "").trim();
  const sentryEnabled = sendDiagnostics && sentryDsn.length > 0;

  if (sentryEnabled) {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION,
      defaultIntegrations: false, // Disable default integrations to avoid issues in tauri
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
    });
    console.info("Sentry initialized with DSN:", sentryDsn);
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
