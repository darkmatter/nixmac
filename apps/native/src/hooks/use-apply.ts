import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { client } from "@/lib/orpc";
import { uiActions } from "@nixmac/state";

/**
 * Proactively check whether activation would overwrite managed files. Hard
 * `/etc` conflicts stop the build; Home Manager backup warnings are surfaced
 * while allowing apply to continue.
 *
 * Returns `true` when hard conflicts were found (caller should abort), `false` when
 * it is safe to proceed. A failed check (e.g. `nix eval` error) is treated as
 * "proceed" — the same conflict would still be caught by the in-flight preflight
 * during the rebuild, so we never block applying on the proactive check itself.
 */
async function hasEtcClobberConflicts(): Promise<boolean> {
  try {
    const result = await client.darwin.checkEtcClobber();
    if (result.conflicts.length === 0 && result.warnings.length === 0) {
      uiActions.setEtcClobber(null);
      return false;
    }
    uiActions.setEtcClobber(result);
    uiActions.setEtcClobberDialogOpen(true);
    return !result.ok;
  } catch (e) {
    console.error("Proactive /etc clobber check failed:", e);
    return false;
  }
}

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 * Finalization state flows through the `*_changed` cell events.
 */
export function useApply() {
  const { triggerRebuild } = useRebuildStream();

  const handleApply = async () => {
    uiActions.setProcessing(true, "apply");

    // Warn about managed-file clobbers before prompting for admin rights. Hard
    // /etc conflicts stop here; backup-only warnings continue into rebuild.
    if (await hasEtcClobberConflicts()) {
      uiActions.setProcessing(false);
      return;
    }

    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        try {
          await client.darwin.finalizeApply();
        } catch (e) {
          console.error("Failed to finalize apply:", e);
        }
      },
    });
  };

  const handleHistoryBuild = async () => {
    uiActions.setProcessing(true, "apply");

    if (await hasEtcClobberConflicts()) {
      uiActions.setProcessing(false);
      return;
    }

    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        await client.darwin.finalizeApply();
      },
    });
  };

  const handleManualBuildConfirm = async () => {
    try {
      await client.darwin.finalizeApply();
    } catch (e) {
      console.error("Failed to finalize manual build:", e);
    }
  };

  return { handleApply, handleHistoryBuild, handleManualBuildConfirm };
}
