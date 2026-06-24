import { uiActions } from "@nixmac/state";
import { tauriAPI } from "@/ipc/api";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";

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

    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        try {
          await tauriAPI.darwin.finalizeApply();
        } catch (e) {
          console.error("Failed to finalize apply:", e);
        }
      },
    });
  };

  const handleHistoryBuild = async () => {
    uiActions.setProcessing(true, "apply");
    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        await tauriAPI.darwin.finalizeApply();
      },
    });
  };

  const handleManualBuildConfirm = async () => {
    try {
      await tauriAPI.darwin.finalizeApply();
    } catch (e) {
      console.error("Failed to finalize manual build:", e);
    }
  };

  return { handleApply, handleHistoryBuild, handleManualBuildConfirm };
}
