import { uiActions } from "@nixmac/state";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { client } from "@/lib/orpc";

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
          await client.darwin.finalizeApply();
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
