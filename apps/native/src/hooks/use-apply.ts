import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { useViewModel } from "@/stores/view-model";
import { getTelemetry } from "@/lib/telemetry/instance";
import type { ApplySource } from "@/lib/telemetry/events";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 */
export function useApply() {
  const { triggerRebuild } = useRebuildStream();

  const captureApplyStarted = (source: ApplySource) => {
    getTelemetry().captureEvent({
      name: "apply_started",
      props: { source },
    });
  };

  const captureApplyCompleted = (source: ApplySource, ok: boolean) => {
    getTelemetry().captureEvent({
      name: "apply_completed",
      props: { result: ok ? "success" : "failure", source },
    });
  };

  const finalizeApply = async (source: ApplySource) => {
    try {
      const result = await tauriAPI.darwin.finalizeApply();
      mirrorGitState(useViewModel.getState().git, false);
      if (result?.gitStatus) {
        mirrorGitState(result.gitStatus);
      }
      if (result?.evolveState) {
        mirrorEvolveState(result.evolveState);
      }
      captureApplyCompleted(source, true);
    } catch (e) {
      captureApplyCompleted(source, false);
      throw e;
    }
  };

  const handleApply = async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    captureApplyStarted("changes");

    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        await finalizeApply("changes");
      },
      onFailure: async () => {
        captureApplyCompleted("changes", false);
      },
    });
  };

  const handleHistoryBuild = async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    captureApplyStarted("history");
    await triggerRebuild({
      context: "apply",
      onSuccess: async () => {
        await finalizeApply("history");
      },
      onFailure: async () => {
        captureApplyCompleted("history", false);
      },
    });
  };

  const handleManualBuildConfirm = async () => {
    captureApplyStarted("manual_confirm");
    try {
      await finalizeApply("manual_confirm");
    } catch (e) {
      console.error("Failed to finalize manual build:", e);
    }
  };

  return { handleApply, handleHistoryBuild, handleManualBuildConfirm };
}
