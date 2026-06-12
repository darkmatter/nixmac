import { useUiState } from "@/stores/ui-state";
import { tauriAPI } from "@/ipc/api";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { useViewModel } from "@/stores/view-model";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 */
export function useApply() {
  const { triggerRebuild } = useRebuildStream();

  const handleApply = async () => {
    useUiState.getState().setProcessing(true, "apply");

    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        try {
          const result = await tauriAPI.darwin.finalizeApply();
          mirrorGitState(useViewModel.getState().git, false);
          if (result?.gitStatus) {
            mirrorGitState(result.gitStatus);
          }
          if (result?.evolveState) {
            mirrorEvolveState(result.evolveState);
          }
        } catch (e) {
          console.error("Failed to finalize apply:", e);
        }
      },
    });
  };

  const handleHistoryBuild = async () => {
    useUiState.getState().setProcessing(true, "apply");
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
      mirrorGitState(useViewModel.getState().git, false);
      if (result?.gitStatus) {
        mirrorGitState(result.gitStatus);
      }
      if (result?.evolveState) {
        mirrorEvolveState(result.evolveState);
      }
    } catch (e) {
      console.error("Failed to finalize manual build:", e);
    }
  };

  return { handleApply, handleHistoryBuild, handleManualBuildConfirm };
}
