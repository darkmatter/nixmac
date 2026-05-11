import * as Sentry from "@sentry/react";
import { bootBreadcrumb } from "@/lib/e2e-boot-diagnostics";
import { darwinAPI } from "@/tauri-api";
import type { UiPrefs as DarwinPrefs } from "@/types/shared";
import { sanitizeSentryEvent } from "./sanitize";

const E2E_MODE = import.meta.env.VITE_NIXMAC_E2E_MODE === "true";

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
  if (E2E_MODE) {
    bootBreadcrumb("Sentry init skipped for E2E boot", {
      viteE2eMode: true,
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

export function captureRenderError(
  reason: "render-error" | "render-fatal",
  error: unknown,
): void {
  void startSentryInitOnce(reason).then(() => {
    if (!E2E_MODE) {
      Sentry.captureException(error);
    }
  });
}

export function attachSentry(): void {
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
}
