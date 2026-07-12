import { tauriAPI } from "@/ipc/api";
import { getTelemetry } from "@/lib/telemetry/instance";
import { useViewModel } from "@nixmac/state";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * One-time disclosure that anonymous diagnostics are enabled by default.
 *
 * Shown once per install (gated on `diagnosticsNoticeAcknowledged`). The
 * acknowledgement is only persisted once the toast leaves the screen
 * (dismissed, auto-closed, or acted on) — if the app quits while the notice
 * is still up, it re-appears on the next launch instead of being silently
 * marked as seen.
 */
export function useDiagnosticsNotice(): void {
  // Ref guard: StrictMode double-invokes effects in dev, and the ack write
  // round-trips through the backend before the viewmodel mirror updates.
  const shown = useRef(false);

  const hydrated = useViewModel((s) => s.preferences !== null && s.preferences !== undefined);
  const acknowledged = useViewModel(
    (s) => s.preferences?.diagnosticsNoticeAcknowledged ?? true,
  );

  useEffect(() => {
    if (!hydrated || acknowledged || shown.current) return;
    shown.current = true;

    const acknowledge = () => {
      void tauriAPI.ui.setPrefs({ diagnosticsNoticeAcknowledged: true });
    };

    toast.info("Anonymous diagnostics are enabled", {
      description:
        "It would help us a lot if you kept this enabled. No file contents or personal data are ever sent. However, you can turn this off anytime in Settings → General.",
      duration: 30000,
      // sonner fires exactly one of these: onDismiss for manual close,
      // onAutoClose for duration expiry. An action click closes the toast
      // without firing either, but that path acknowledges via setPrefs below.
      onDismiss: acknowledge,
      onAutoClose: acknowledge,
      action: {
        label: "Turn off",
        onClick: () => {
          // setPrefs also marks the notice acknowledged backend-side.
          void tauriAPI.ui.setPrefs({ sendDiagnostics: false });
          getTelemetry().setEnabled(false);
          // The Rust OTEL pipeline reads the pref once at startup, so error
          // reporting keeps running until relaunch (same caveat as the
          // Settings toggle, which discloses "Restart required").
          toast.info("Diagnostics turned off. Restart nixmac to fully stop background reporting.");
        },
      },
    });
  }, [hydrated, acknowledged]);
}
