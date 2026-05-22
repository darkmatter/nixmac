import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/tauri-api";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 */
export function useApply() {
  const { triggerRebuild } = useRebuildStream();

  const handleApply = async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");

    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        try {
          const result = await tauriAPI.darwin.finalizeApply();
          useWidgetStore.getState().setExternalBuildDetected(false);
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
  };

  const handleHistoryBuild = async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        await tauriAPI.darwin.finalizeApply();
      },
    });
  };

  const handleManualBuildConfirm = async () => {
    try {
      const result = await tauriAPI.darwin.finalizeApply();
      useWidgetStore.getState().setExternalBuildDetected(false);
      if (result?.gitStatus) {
        useWidgetStore.getState().setGitStatus(result.gitStatus);
      }
      if (result?.evolveState) {
        useWidgetStore.getState().setEvolveState(result.evolveState);
      }
    } catch (e) {
      console.error("Failed to finalize manual build:", e);
    }
  };

  return { handleApply, handleHistoryBuild, handleManualBuildConfirm };
}
