import { tauriAPI } from "@/ipc/api";

const MAX_DETAIL_LENGTH = 1_000;
const APP_TITLE = "nixmac";

const e2eBootDiagnosticsEnabled = import.meta.env.VITE_NIXMAC_E2E_MODE === "true";
let bootStageCleared = false;

function setStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in restricted WebView states; the title/data marker is enough.
  }
}

function normalizeBootStage(stage: string): string {
  return stage.replace(/[^\w:.-]/g, "-").slice(0, 80);
}

function setBootStageDomMarker(stage: string) {
  document.documentElement.dataset.nixmacBootStage = stage;
  document.title = `nixmac boot:${stage}`;
}

function markNativeBootStage(stage: string) {
  void tauriAPI.debug.markBootStage(stage, Date.now()).catch(() => {});
}

/** E2E-only render-body marker: DOM/title only, no IPC or localStorage. */
export function markBootRenderStage(stage: string) {
  if (!e2eBootDiagnosticsEnabled || bootStageCleared) return;

  const normalizedStage = normalizeBootStage(stage);
  setBootStageDomMarker(normalizedStage);
}

/** E2E-only effect/event-safe marker with full out-of-band persistence. */
export function markBootStage(stage: string) {
  if (!e2eBootDiagnosticsEnabled || bootStageCleared) return;

  const normalizedStage = normalizeBootStage(stage);
  setBootStageDomMarker(normalizedStage);
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
  if (!e2eBootDiagnosticsEnabled) return;
  const clientTimestampUnixMs = Date.now();
  const summarized = summarizeDetail(detail);
  console.info(`[nixmac boot] ${label}`, summarized ?? "");
  void tauriAPI.debug.logBreadcrumb(label, summarized, clientTimestampUnixMs).catch(() => {});
}
