import { bootBreadcrumb } from "@/lib/boot-diagnostics";
import { isE2eProfile } from "@/lib/env";
import { sanitizeDiagnosticText } from "@/lib/telemetry/sanitize";

const e2eBootDiagnosticsEnabled = isE2eProfile;

function setStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in restricted WebView states; the title/data marker is enough.
  }
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function excerpt(value: string, maxLength: number) {
  const sanitized = sanitizeDiagnosticText(value).replace(/\s+/g, " ").trim();
  if (sanitized.length <= maxLength) return sanitized;
  return `${sanitized.slice(0, maxLength)}...`;
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
    title: sanitizeDiagnosticText(document.title || ""),
    bootStage: sanitizeDiagnosticText(document.documentElement.dataset.nixmacBootStage ?? ""),
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
