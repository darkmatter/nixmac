import { darwinAPI } from "@/tauri-api";

const MAX_DETAIL_LENGTH = 1_000;

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
