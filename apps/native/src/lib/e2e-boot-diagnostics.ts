import { darwinAPI } from "@/tauri-api";

const MAX_DETAIL_LENGTH = 1_000;
const APP_TITLE = "nixmac";
const REDACTED = "[REDACTED]";
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

const e2eBootDiagnosticsEnabled = import.meta.env.VITE_NIXMAC_SKIP_PERMISSIONS === "true";
let bootStageCleared = false;

export function e2eBootDiagnosticsActive() {
  return e2eBootDiagnosticsEnabled;
}

function setStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in restricted WebView states; the title/data marker is enough.
  }
}

function markNativeBootStage(stage: string) {
  void darwinAPI.debug.markBootStage(stage, Date.now()).catch(() => {});
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function e2eErrorClass(error: unknown): string | null {
  if (error == null) return null;
  if (error instanceof Error) {
    return error.constructor?.name || error.name || "Error";
  }
  return typeof error;
}

function sanitizeUrl(value: string): string {
  if (!(value.startsWith("http://") || value.startsWith("https://"))) {
    return value;
  }

  try {
    const url = new URL(value);
    url.search = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function sanitizeE2eDiagnosticText(value: string): string {
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
  return sanitizeUrl(sanitized).replace(/[^\t\x20-\x7e]/g, "");
}

function excerpt(value: string, maxLength: number) {
  const sanitized = sanitizeE2eDiagnosticText(value).replace(/\s+/g, " ").trim();
  if (sanitized.length <= maxLength) return sanitized;
  return `${sanitized.slice(0, maxLength)}...`;
}

export function markBootStage(stage: string) {
  if (!e2eBootDiagnosticsEnabled || bootStageCleared) return;

  // E2E-only: intentionally callable from render bodies to expose pre-effect hangs.
  const normalizedStage = stage.replace(/[^\w:.-]/g, "-").slice(0, 80);
  document.documentElement.dataset.nixmacBootStage = normalizedStage;
  document.title = `nixmac boot:${normalizedStage}`;
  setStorageValue("nixmac:e2e-boot-stage", normalizedStage);
  markNativeBootStage(normalizedStage);
  console.info(`[nixmac boot-stage] ${normalizedStage}`);
}

export function clearBootStage() {
  if (!e2eBootDiagnosticsEnabled) return;

  bootStageCleared = true;
  document.documentElement.dataset.nixmacBootStage = "mounted";
  document.title = APP_TITLE;
  setStorageValue("nixmac:e2e-boot-stage", "mounted");
  markNativeBootStage("mounted");
}

function summarizeDetail(detail: unknown): string | undefined {
  if (detail == null) return undefined;

  let text: string;
  if (detail instanceof Error) {
    text = `${detail.name}: ${detail.message}`;
  } else if (typeof detail === "string") {
    text = detail;
  } else {
    try {
      text = JSON.stringify(detail);
    } catch {
      text = String(detail);
    }
  }

  return text.replace(/[^\t\x20-\x7e]/g, "").slice(0, MAX_DETAIL_LENGTH);
}

export function bootBreadcrumb(label: string, detail?: unknown) {
  const clientTimestampUnixMs = Date.now();
  const summarized = summarizeDetail(detail);
  console.info(`[nixmac boot] ${label}`, summarized ?? "");
  void darwinAPI.debug.logBreadcrumb(label, summarized, clientTimestampUnixMs).catch(() => {});
}

type StartupStateDiagnostic = {
  currentStep: string;
  configDirPresent: boolean;
  hostPresent: boolean;
  hostKnown: boolean;
  hostsCount: number;
  nixInstalled: boolean | null;
  darwinRebuildAvailable: boolean | null;
  permissionsChecked: boolean;
  permissionsComplete: boolean;
  prefsLoaded: boolean;
  errorClass: string | null;
};

export function recordE2eStartupState(label: string, state: StartupStateDiagnostic) {
  if (!e2eBootDiagnosticsEnabled) return;

  const bodyText = sanitizeE2eDiagnosticText(document.body?.innerText ?? "");
  bootBreadcrumb(`E2E startup state ${label}`, {
    label,
    currentStep: state.currentStep,
    configDirPresent: state.configDirPresent,
    hostPresent: state.hostPresent,
    hostKnown: state.hostKnown,
    hostsCount: state.hostsCount,
    nixInstalled: state.nixInstalled,
    darwinRebuildAvailable: state.darwinRebuildAvailable,
    permissionsChecked: state.permissionsChecked,
    permissionsComplete: state.permissionsComplete,
    prefsLoaded: state.prefsLoaded,
    errorClass: state.errorClass,
    bodyTextLength: bodyText.length,
    bodyTextHash: simpleHash(bodyText),
  });
}

type DomSnapshotOptions = {
  storagePrefix?: string;
};

export function recordE2eDomSnapshot(label: string, options: DomSnapshotOptions = {}) {
  if (!e2eBootDiagnosticsEnabled) return;

  const root = document.getElementById("root");
  const rawBodyText = document.body?.innerText ?? "";
  const rawRootHtml = root?.innerHTML ?? "";
  const snapshot = {
    label,
    title: sanitizeE2eDiagnosticText(document.title || ""),
    bootStage: sanitizeE2eDiagnosticText(document.documentElement.dataset.nixmacBootStage ?? ""),
    rootChildCount: root?.childElementCount ?? null,
    bodyTextLength: rawBodyText.length,
    rootHtmlLength: rawRootHtml.length,
    bodyTextHash: simpleHash(rawBodyText),
    rootHtmlHash: simpleHash(rawRootHtml),
    bodyWidth: document.body?.clientWidth ?? null,
    bodyHeight: document.body?.clientHeight ?? null,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
  const textExcerpt = excerpt(rawBodyText, 360);
  const htmlExcerpt = excerpt(rawRootHtml, 520);
  const compact = JSON.stringify({
    label: snapshot.label,
    title: snapshot.title,
    bootStage: snapshot.bootStage,
    rootChildCount: snapshot.rootChildCount,
    bodyTextLength: snapshot.bodyTextLength,
    rootHtmlLength: snapshot.rootHtmlLength,
    bodyTextHash: snapshot.bodyTextHash,
    rootHtmlHash: snapshot.rootHtmlHash,
  });

  const storagePrefix = options.storagePrefix ?? "nixmac:e2e-dom-snapshot";
  document.documentElement.dataset.nixmacE2eDomSnapshot = compact.slice(0, 900);
  setStorageValue(`${storagePrefix}:last`, compact);
  setStorageValue(`${storagePrefix}:text`, textExcerpt);
  setStorageValue(`${storagePrefix}:html`, htmlExcerpt);

  bootBreadcrumb(`E2E DOM snapshot ${label} summary`, snapshot);
  bootBreadcrumb(`E2E DOM snapshot ${label} text`, textExcerpt);
  bootBreadcrumb(`E2E DOM snapshot ${label} html`, htmlExcerpt);
}

export function scheduleE2eDomSnapshots(prefix: string, count = 5, intervalMs = 2_000) {
  if (!e2eBootDiagnosticsEnabled) return;

  let emitted = 0;
  const emit = () => {
    emitted += 1;
    recordE2eDomSnapshot(`${prefix}-${emitted}`);
    if (emitted < count) {
      window.setTimeout(emit, intervalMs);
    }
  };
  window.setTimeout(emit, 0);
}
