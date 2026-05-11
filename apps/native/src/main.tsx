import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";
import {
  bootBreadcrumb,
  markBootStage,
  recordE2eDomSnapshot,
  scheduleE2eDomSnapshots,
} from "@/lib/e2e-boot-diagnostics";
import { attachSentry, captureRenderError } from "@/lib/sentry/init";
import { StartupFallback } from "@/components/StartupFallback";

const rootElement = document.getElementById("root");

bootBreadcrumb("main.tsx loaded");
markBootStage("main-loaded");

if (!rootElement) {
  bootBreadcrumb("root element missing");
  throw new Error("Root element not found");
}
bootBreadcrumb("root element found");
markBootStage("root-found");

const E2E_APP_MOUNT_RELOAD_TIMEOUT_MS = 12000;
const E2E_APP_MOUNT_RELOAD_KEY = "nixmac:e2e-app-mount-reload-attempted";
// Build-time flag identifying an E2E build. In that mode, the harness-only
// instrumentation (heartbeat, watchdog, DOM snapshots) is active.
const E2E_MODE = import.meta.env.VITE_NIXMAC_E2E_MODE === "true";

let bootHeartbeatStopped = false;
let bootHeartbeatTick = 0;
let bootHeartbeat: number | null = null;

if (E2E_MODE) {
  bootHeartbeat = window.setInterval(() => {
    if (bootHeartbeatStopped) {
      if (bootHeartbeat !== null) {
        window.clearInterval(bootHeartbeat);
      }
      return;
    }
    bootHeartbeatTick += 1;
    bootBreadcrumb("boot heartbeat", { tick: bootHeartbeatTick });
    if (bootHeartbeatTick >= 30) {
      bootBreadcrumb("boot heartbeat upper bound reached", { tick: bootHeartbeatTick });
      if (bootHeartbeat !== null) {
        window.clearInterval(bootHeartbeat);
      }
    }
  }, 1000);
}

const stopBootHeartbeat = () => {
  if (!bootHeartbeatStopped) {
    bootHeartbeatStopped = true;
    if (bootHeartbeat !== null) {
      window.clearInterval(bootHeartbeat);
    }
    bootBreadcrumb("boot heartbeat stopped", { tick: bootHeartbeatTick });
  }
};

window.addEventListener(
  "nixmac:app-mounted",
  () => {
    bootBreadcrumb("app mounted event received");
    scheduleE2eDomSnapshots("post-mount");
    window.sessionStorage.removeItem(E2E_APP_MOUNT_RELOAD_KEY);
    stopBootHeartbeat();
  },
  { once: true },
);

window.addEventListener("error", (event) => {
  bootBreadcrumb("window error", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  bootBreadcrumb("window unhandled rejection", event.reason);
});

attachSentry();

const root = ReactDOM.createRoot(rootElement);

if (E2E_MODE) {
  window.setTimeout(() => {
    if (bootHeartbeatStopped) {
      return;
    }

    if (window.sessionStorage.getItem(E2E_APP_MOUNT_RELOAD_KEY) === "true") {
      bootBreadcrumb("E2E app-mounted watchdog exhausted", {
        timeoutMs: E2E_APP_MOUNT_RELOAD_TIMEOUT_MS,
      });
      return;
    }

    window.sessionStorage.setItem(E2E_APP_MOUNT_RELOAD_KEY, "true");
    recordE2eDomSnapshot("app-mounted-watchdog-before-reload", {
      storagePrefix: "nixmac:e2e-dom-snapshot:watchdog-pre-reload",
    });
    bootBreadcrumb("E2E app-mounted watchdog reloading", {
      timeoutMs: E2E_APP_MOUNT_RELOAD_TIMEOUT_MS,
      rootChildCount: rootElement.childElementCount,
    });
    window.setTimeout(() => {
      window.location.reload();
    }, 250);
  }, E2E_APP_MOUNT_RELOAD_TIMEOUT_MS);
}

const renderApp = () => {
  bootBreadcrumb("React render start");
  markBootStage("react-render-start");
  root.render(
    <React.StrictMode>
      <Sentry.ErrorBoundary
        fallback={<StartupFallback />}
        onError={(error, componentStack) => {
          console.error("ErrorBoundary caught:", error, componentStack);
          bootBreadcrumb("ErrorBoundary caught render error", error);
          captureRenderError("render-error", error);
        }}
      >
        <App />
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
  bootBreadcrumb("React render scheduled");
  markBootStage("react-render-scheduled");
};

try {
  renderApp();
} catch (error) {
  bootBreadcrumb("React render fatal error", error);
  markBootStage("react-render-fatal");
  captureRenderError("render-fatal", error);
  root.render(<StartupFallback />);
}

window.setTimeout(() => {
  bootBreadcrumb("post-render dom probe", {
    rootChildCount: rootElement.childElementCount,
    bodyWidth: document.body?.clientWidth ?? null,
    bodyHeight: document.body?.clientHeight ?? null,
  });
}, 0);
