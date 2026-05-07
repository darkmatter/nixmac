import { darwinAPI } from "@/tauri-api";

const MAX_DETAIL_LENGTH = 1_000;
const APP_TITLE = "nixmac";

const e2eBootDiagnosticsEnabled = import.meta.env.VITE_NIXMAC_SKIP_PERMISSIONS === "true";
let bootStageCleared = false;

function setStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in restricted WebView states; the title/data marker is enough.
  }
}

export function markBootStage(stage: string) {
  if (!e2eBootDiagnosticsEnabled || bootStageCleared) return;

  // E2E-only: intentionally callable from render bodies to expose pre-effect hangs.
  const normalizedStage = stage.replace(/[^\w:.-]/g, "-").slice(0, 80);
  document.documentElement.dataset.nixmacBootStage = normalizedStage;
  document.title = `nixmac boot:${normalizedStage}`;
  setStorageValue("nixmac:e2e-boot-stage", normalizedStage);
  console.info(`[nixmac boot-stage] ${normalizedStage}`);
}

export function clearBootStage() {
  if (!e2eBootDiagnosticsEnabled) return;

  bootStageCleared = true;
  document.documentElement.dataset.nixmacBootStage = "mounted";
  document.title = APP_TITLE;
  setStorageValue("nixmac:e2e-boot-stage", "mounted");
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
