import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

function FallbackComponent() {
  return <div>Something went wrong.</div>;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const sentryDsn = (import.meta.env.VITE_SENTRY_DSN || "").trim();

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
  });
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {sentryDsn ? (
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
