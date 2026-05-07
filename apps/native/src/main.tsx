import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";
import { darwinAPI } from "@/tauri-api";
import type { UiPrefs as DarwinPrefs } from "@/types/shared";
import {
  bootBreadcrumb,
  markBootStage,
  recordE2eDomSnapshot,
  scheduleE2eDomSnapshots,
} from "@/lib/e2e-boot-diagnostics";

function FallbackComponent() {
  return (
    <div
      style={{
        alignItems: "center",
        background: "#0a0a0a",
        color: "#f4f4f5",
        display: "flex",
        height: "100vh",
        justifyContent: "center",
        width: "100vw",
      }}
    >
      <div
        role="alert"
        style={{
          background: "#27272a",
          border: "1px solid #52525b",
          borderRadius: 12,
          boxShadow: "0 18px 50px rgba(0, 0, 0, 0.45)",
          maxWidth: 460,
          padding: "24px 28px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>nixmac could not render</div>
        <div style={{ color: "#d4d4d8", fontSize: 13, lineHeight: 1.5 }}>
          The app shell hit a startup error. Diagnostic breadcrumbs were recorded for this run.
        </div>
      </div>
    </div>
  );
}

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
// This existing flag marks E2E/dev permission bypass builds. In that mode, boot must not
// introduce another preference IPC before the app shell has rendered.
const E2E_BOOT_PREFS_DISABLED = import.meta.env.VITE_NIXMAC_SKIP_PERMISSIONS === "true";

let bootHeartbeatStopped = false;
let bootHeartbeatTick = 0;
let bootHeartbeat: number | null = null;

if (E2E_BOOT_PREFS_DISABLED) {
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

const REDACTED = "[REDACTED]";
const REDACTED_APP_CONTENT = "[REDACTED_APP_CONTENT]";

// These are really more common to web apps, but we'll include them just in case.
const SENSITIVE_KEY_PATTERN =
  /password|passwd|pwd|secret|token|api[-_]?key|authorization|cookie|session|bearer|email|phone|ssn|credit|card|cvv|cvc|iban|account|address|ip|private[-_]?key|ssh|gpg/i;

// These are the kinds of things we work with in nixmac, although it's extremely hard
// to guess exactly how they might appear in the data - for example, a diff or config
// file might be embedded in a larger string, or split across multiple fields, etc.
// So we'll just broadly look for any keys that might indicate the value contains app
// content and redact it wholesale, rather than trying to apply regexes to extract specific
// secrets from within them.
const APP_CONTENT_KEY_PATTERN =
  /prompt|messages|conversation|completion|response|input|output|diff|patch|nix(?:[-_]?darwin)?(?:[-_]?config)?|configuration|config[-_]?text|file[-_]?content|command|args|stderr|stdout|path|cwd|home/i;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gi;
const OPENAI_TOKEN_PATTERN = /\bsk-[A-Za-z0-9]{20,}\b/g;
const ANTHROPIC_TOKEN_PATTERN = /\bsk-ant-[A-Za-z0-9_-]{20,}\b/gi;
const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const HOME_DIR_PATH_PATTERN = /\/Users\/[^/\s'"`]+/g;
const NIX_SECRET_ASSIGNMENT_PATTERN =
  /\b(password|passwd|token|secret|api[-_]?key|private[-_]?key)\s*=\s*(".*?"|'.*?'|[^\s;]+)/gi;

const sanitizeUrl = (value: string): string => {
  if (!(value.startsWith("http://") || value.startsWith("https://"))) {
    return value;
  }

  try {
    const url = new URL(value);
    if (url.search) {
      url.search = "";
    }
    return url.toString();
  } catch {
    return value;
  }
};

const sanitizeString = (value: string): string => {
  let sanitized = value;
  sanitized = sanitized.replace(EMAIL_PATTERN, REDACTED);
  sanitized = sanitized.replace(BEARER_TOKEN_PATTERN, REDACTED);
  sanitized = sanitized.replace(GITHUB_TOKEN_PATTERN, REDACTED);
  sanitized = sanitized.replace(OPENAI_TOKEN_PATTERN, REDACTED);
  sanitized = sanitized.replace(ANTHROPIC_TOKEN_PATTERN, REDACTED);
  sanitized = sanitized.replace(PRIVATE_KEY_BLOCK_PATTERN, REDACTED);
  sanitized = sanitized.replace(HOME_DIR_PATH_PATTERN, "/Users/[REDACTED_USER]");
  sanitized = sanitized.replace(NIX_SECRET_ASSIGNMENT_PATTERN, (_, key: string) => {
    return `${key} = ${REDACTED}`;
  });

  return sanitizeUrl(sanitized);
};

const sanitizeSentryValue = (value: unknown, keyName = ""): unknown => {
  if (SENSITIVE_KEY_PATTERN.test(keyName)) {
    return REDACTED;
  }

  if (APP_CONTENT_KEY_PATTERN.test(keyName)) {
    if (typeof value === "string" && value.length > 0) {
      return REDACTED_APP_CONTENT;
    }
    if (Array.isArray(value)) {
      return REDACTED_APP_CONTENT;
    }
    if (value && typeof value === "object") {
      return REDACTED_APP_CONTENT;
    }
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSentryValue(entry));
  }

  if (value && typeof value === "object") {
    const sanitizedObject: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitizedObject[childKey] = sanitizeSentryValue(childValue, childKey);
    }
    return sanitizedObject;
  }

  return value;
};

const sanitizeSentryEvent = (event: unknown): unknown => {
  const sanitized = sanitizeSentryValue(event);
  if (!sanitized || typeof sanitized !== "object") {
    return sanitized;
  }

  const sanitizedRecord = sanitized as Record<string, unknown>;
  delete sanitizedRecord.user;
  delete sanitizedRecord.server_name;

  return sanitizedRecord;
};

const PREFS_BOOT_TIMEOUT_MS = 8000;
const SENTRY_MOUNT_TIMEOUT_MS = 5000;

const loadPrefsForBoot = async (): Promise<DarwinPrefs | null> => {
  bootBreadcrumb("ui_get_prefs invoke start");
  let settled = false;
  let timedOut = false;

  const prefsPromise = darwinAPI.ui
    .getPrefs()
    .then((prefs) => {
      settled = true;
      bootBreadcrumb(
        timedOut ? "ui_get_prefs invoke success after timeout" : "ui_get_prefs invoke success",
        {
          sendDiagnostics: prefs.sendDiagnostics,
        },
      );
      return prefs;
    })
    .catch((error) => {
      settled = true;
      bootBreadcrumb(
        timedOut ? "ui_get_prefs invoke error after timeout" : "ui_get_prefs invoke error",
        error,
      );
      return null;
    });

  const timeoutPromise = new Promise<null>((resolve) => {
    window.setTimeout(() => {
      if (!settled) {
        timedOut = true;
        bootBreadcrumb("ui_get_prefs invoke timeout", `${PREFS_BOOT_TIMEOUT_MS}ms`);
      }
      resolve(null);
    }, PREFS_BOOT_TIMEOUT_MS);
  });

  return Promise.race([prefsPromise, timeoutPromise]);
};

const initializeSentryAfterPostMountFrame = async () => {
  if (E2E_BOOT_PREFS_DISABLED) {
    bootBreadcrumb("Sentry init skipped for E2E boot", {
      viteSkipPermissions: true,
    });
    console.info("Sentry not enabled during E2E boot.");
    return;
  }

  const prefs = await loadPrefsForBoot();
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
    bootBreadcrumb("Sentry init enabled", { environment, release });
    Sentry.init({
      dsn: sentryDsn,
      environment: environment,
      release: release,
      defaultIntegrations: false, // Disable default integrations to avoid issues in tauri
      integrations: [Sentry.browserTracingIntegration()],
      // Disable all breadcrumbs by returning `null`
      beforeBreadcrumb: () => null,
      beforeSend: (event) => {
        const sanitized = sanitizeSentryEvent(event);
        // console.log("[Sentry beforeSend]", { original: event, sanitized });
        return sanitized as typeof event;
      },
      tracesSampleRate: 0.1,
    });
    console.info("Sentry initialized.", {
      environment: environment,
      release: release,
    });
  } else {
    bootBreadcrumb("Sentry init skipped", {
      sendDiagnostics,
      hasDsn: sentryDsn.length > 0,
    });
    console.info("Sentry not enabled.");
  }
};

const root = ReactDOM.createRoot(rootElement);
let sentryInitStarted = false;
let sentryInitPromise: Promise<void> | null = null;

const scheduleAfterPostMountFrame = (callback: () => void) => {
  bootBreadcrumb("post-mount init scheduled");
  const run = () => {
    bootBreadcrumb("post-mount first frame elapsed");
    callback();
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return;
  }

  window.setTimeout(run, 0);
};

const startSentryInitOnce = (
  reason: "app-mounted" | "mount-timeout" | "render-error" | "render-fatal",
): Promise<void> => {
  if (sentryInitStarted) {
    bootBreadcrumb("Sentry init start ignored", { reason });
    return sentryInitPromise ?? Promise.resolve();
  }

  sentryInitStarted = true;
  bootBreadcrumb("Sentry init start requested", { reason });
  sentryInitPromise = new Promise((resolve) => {
    scheduleAfterPostMountFrame(() => {
      void initializeSentryAfterPostMountFrame()
        .catch((error) => {
          bootBreadcrumb("post-render Sentry init error", error);
        })
        .finally(resolve);
    });
  });

  return sentryInitPromise;
};

const captureRenderErrorAfterSentryInit = (
  reason: "render-error" | "render-fatal",
  error: unknown,
) => {
  void startSentryInitOnce(reason).then(() => {
    if (!E2E_BOOT_PREFS_DISABLED) {
      Sentry.captureException(error);
    }
  });
};

window.addEventListener(
  "nixmac:app-mounted",
  () => {
    startSentryInitOnce("app-mounted");
  },
  { once: true },
);

window.setTimeout(() => {
  startSentryInitOnce("mount-timeout");
}, SENTRY_MOUNT_TIMEOUT_MS);

if (E2E_BOOT_PREFS_DISABLED) {
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
        fallback={<FallbackComponent />}
        onError={(error, componentStack) => {
          console.error("ErrorBoundary caught:", error, componentStack);
          bootBreadcrumb("ErrorBoundary caught render error", error);
          captureRenderErrorAfterSentryInit("render-error", error);
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
  captureRenderErrorAfterSentryInit("render-fatal", error);
  root.render(<FallbackComponent />);
}

window.setTimeout(() => {
  bootBreadcrumb("post-render dom probe", {
    rootChildCount: rootElement.childElementCount,
    bodyWidth: document.body?.clientWidth ?? null,
    bodyHeight: document.body?.clientHeight ?? null,
  });
}, 0);
