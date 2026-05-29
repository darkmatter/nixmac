import { useFeedbackStore } from "@/stores/feedback-store";

const RECOVERY_STORAGE_KEY = "nixmac:pending-error-report";

type StoredErrorReport = {
  name: string;
  message: string;
  stack: string;
  timestamp: string;
};

function readStoredReport(): StoredErrorReport | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredErrorReport>;
    if (typeof parsed.message !== "string" || parsed.message.length === 0)
      return null;
    return {
      name:
        typeof parsed.name === "string" && parsed.name.length > 0
          ? parsed.name
          : "Error",
      message: parsed.message,
      stack: typeof parsed.stack === "string" ? parsed.stack : "",
      timestamp:
        typeof parsed.timestamp === "string"
          ? parsed.timestamp
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function clearStoredReport(): void {
  try {
    window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in restricted webviews; the next boot
    // will overwrite or replace the key anyway.
  }
}

/**
 * Picks up an error report stashed by `AppFatalFallback` before a recovery
 * reload and surfaces it through the widget's normal error UI: the
 * ErrorMessage panel shows the recovery notice with the existing Report and
 * Dismiss actions, and the Header's feedback icon flashes via its standard
 * error-change subscription. The Report button then opens the FeedbackDialog
 * with the captured panic details pre-filled.
 *
 * Called inside the widget's initialization chain after the widget has
 * reached a state where the ErrorMessage panel is visible.
 */
export function surfaceRecoveryReport(): void {
  const report = readStoredReport();
  if (!report) return;
  clearStoredReport();

  const { setError, setPanicDetails } = useFeedbackStore.getState();

  setPanicDetails({
    message: report.message,
    location: undefined,
    backtrace: report.stack.length > 0 ? report.stack : undefined,
    timestamp: report.timestamp,
  });

  setError(`Recovered from an unexpected error: ${report.message}`);
}
