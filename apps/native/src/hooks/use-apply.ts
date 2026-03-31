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
          const gitStatus = await darwinAPI.darwin.finalizeApply();
          if (gitStatus) {
            useWidgetStore.getState().setGitStatus(gitStatus);
          }
        } catch (e) {
          console.error("Failed to finalize apply:", e);
        }
      },
    });
  }, [triggerRebuild]);

  return { handleApply };
}
