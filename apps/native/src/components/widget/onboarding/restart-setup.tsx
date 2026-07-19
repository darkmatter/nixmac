import { ConfirmationDialog } from "@/components/widget/controls/confirmation-dialog";
import { getTelemetry } from "@/lib/telemetry/instance";
import { client } from "@/lib/orpc";
import { clearRebuildProjection } from "@/viewmodel/rebuild";
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
  clearRebuildProjection();
  getTelemetry().captureEvent({ name: "onboarding_restarted" });
  return true;
}

interface RestartSetupConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Which lifecycle moment the confirmation is shown at, deciding the
   * warning copy. Mid-wizard ("midFlow"), a directory that setup imported
   * or scaffolded itself and that was never built is deleted by the reset,
   * so the copy must say so. Post-completion surfaces (Settings, the repair
   * card) pass "completed": completion implies a successful build, and the
   * reset never deletes a built configuration — that clause would be wrong
   * and scary there.
   */
  context: "midFlow" | "completed";
  /** Runs after a successful reset — e.g. close the settings dialog so the
   * re-surfaced wizard is visible. */
  onRestarted?: () => void;
}

const COMMON_WARNING =
  "This discards your configuration directory selection, the chosen host, and recorded setup progress (Mac scan, login choice, first build).";

const WARNING_BY_CONTEXT = {
  midFlow: `${COMMON_WARNING} Files on disk are kept — except a configuration that setup imported or created itself and that was never built, which is deleted.`,
  completed: `${COMMON_WARNING} Files on disk are kept.`,
} as const;

/**
 * Shared "Restart setup" confirmation, rendered from the onboarding header
 * and from Settings → General with context-appropriate warning copy.
 */
export function RestartSetupConfirmation({
  open,
  onOpenChange,
  context,
  onRestarted,
}: RestartSetupConfirmationProps) {
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Restart setup from the beginning?"
      message={WARNING_BY_CONTEXT[context]}
      color="amber"
      onConfirm={() => {
        void restartSetup().then((ok) => {
          if (ok) onRestarted?.();
        });
      }}
    />
  );
}
