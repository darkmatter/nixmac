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
