import { ConfirmationDialog } from "@/components/widget/controls/confirmation-dialog";
import { getTelemetry } from "@/lib/telemetry/instance";
import { client } from "@/lib/orpc";
import { onboardingActions } from "@nixmac/state";
import { toast } from "sonner";

/** Rewinds onboarding to the config-dir step. The backend clears the
 * completion latch and the durable facts the step machine derives progress
 * from (and deletes a config dir or parked import it materialized itself),
 * then the onboarding-state/preferences events re-surface the wizard — no
 * navigation needed here. */
async function restartSetup() {
  try {
    await client.onboarding.reset();
  } catch (error) {
    // Typically the backend refusing to reset while a build is running.
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
  onboardingActions.reset();
  getTelemetry().captureEvent({ name: "onboarding_restarted" });
  return true;
}

interface RestartSetupConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful reset — e.g. close the settings dialog so the
   * re-surfaced wizard is visible. */
  onRestarted?: () => void;
}

/**
 * Shared "Restart setup" confirmation, rendered from the onboarding header
 * and from Settings → General. The copy spells out what is lost: restarting
 * discards recorded setup progress, not on-disk configuration files (except
 * a never-built directory that setup itself materialized).
 */
export function RestartSetupConfirmation({
  open,
  onOpenChange,
  onRestarted,
}: RestartSetupConfirmationProps) {
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Restart setup from the beginning?"
      message="This discards your configuration directory selection, the chosen host, and recorded setup progress (Mac scan, login choice, first build). Files on disk are kept — except a configuration that setup imported or created itself and that was never built, which is deleted."
      color="amber"
      onConfirm={() => {
        void restartSetup().then((ok) => {
          if (ok) onRestarted?.();
        });
      }}
    />
  );
}
