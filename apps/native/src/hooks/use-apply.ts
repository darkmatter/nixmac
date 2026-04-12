import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 */
export function useApply() {
  const { triggerRebuild } = useRebuildStream();

  const handleApply = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");

    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        try {
          const result = await darwinAPI.darwin.finalizeApply();
          if (result?.gitStatus) {
            useWidgetStore.getState().setGitStatus(result.gitStatus);
          }
          if (result?.evolveState) {
            useWidgetStore.getState().setEvolveState(result.evolveState);
          }
        } catch (e) {
          console.error("Failed to finalize apply:", e);
        }
      },
    });
  }, [triggerRebuild]);

  const handleHistoryBuild = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    await triggerRebuild({ context: "apply" });
  }, [triggerRebuild]);

  return { handleApply, handleHistoryBuild };
}
