import { ConfirmationDialog } from "@/components/widget/controls/confirmation-dialog";
import { getTelemetry } from "@/lib/telemetry/instance";
import { client } from "@/lib/orpc";
import { onboardingActions } from "@nixmac/state";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  title: string;
}

/** Rewinds onboarding to the config-dir step. The backend clears the durable
 * facts the step machine derives progress from (and deletes a config dir it
 * materialized itself), then the preferences-changed event re-routes the flow
 * — no navigation needed here. */
async function restartSetup() {
  // An import parked on the flake-dir chooser lives only on disk; discard it
  // first or the reset would orphan the tree.
  const pendingImportDir = onboardingActions.getState().pendingImportDir;
  try {
    if (pendingImportDir) {
      await client.config.discardImport({ dir: pendingImportDir });
    }
    await client.onboarding.reset();
  } catch (error) {
    // Typically the backend refusing to reset while a build is running.
    toast.error(error instanceof Error ? error.message : String(error));
    return;
  }
  onboardingActions.reset();
  getTelemetry().captureEvent({ name: "onboarding_restarted" });
}

export function OnboardingHeader({ title }: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <header
      className="mb-8 flex shrink-0 select-none items-center justify-between"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" className="size-8 object-contain" aria-hidden="true" />
        <span className="font-semibold text-base tracking-tight">nixmac</span>
      </div>

      <div className="flex items-center gap-1">
        <h3 className="font-normal  text-xs tracking-tight text-zinc-400 font-mono uppercase">{title}</h3>
      </div>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Restart setup
      </button>

      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Restart setup from the beginning?"
        message="Progress so far is discarded, and a configuration that was imported or created during setup is deleted. A pre-existing configuration directory you selected yourself is kept."
        color="amber"
        onConfirm={() => {
          void restartSetup();
        }}
      />
    </header>
  );
}
