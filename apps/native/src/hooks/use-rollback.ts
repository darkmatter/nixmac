import { useUiState } from "@/stores/ui-state";
import { tauriAPI } from "@/ipc/api";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { useSummary } from "@/hooks/use-summary";
import { useViewModel } from "@/stores/view-model";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
import { getTelemetry } from "@/lib/telemetry/instance";
/**
 * Hook for discarding changes and restoring the working tree to its pre-evolution state.
 */
export function useRollback() {
  const { triggerRebuild } = useRebuildStream();
  const { findChangeMap } = useSummary();

  const handleRollback = async () => {
    const ui = useUiState.getState();
    const wasCommittable = useViewModel.getState().evolve?.committable === true;

    ui.setProcessing(true, "cancel");
    ui.appendLog("\n> Discarding changes...\n");

    try {
      const result = await tauriAPI.darwin.rollbackErase();
      mirrorGitState(result.gitStatus);
      mirrorEvolveState(result.evolveState);
      ui.setEvolvePrompt("");
      ui.appendLog("✓ Changes discarded\n");

      // Track rollback
      getTelemetry().captureEvent({ name: "rollback_performed" });

      if (result.rollbackStorePath && wasCommittable) {
        await triggerRebuild({
          context: "rollback",
          storePath: result.rollbackStorePath,
          onSuccess: async () => {
            const finalResult = await tauriAPI.darwin.finalizeRollback(
              result.rollbackStorePath,
              result.rollbackChangesetId,
            );
            if (finalResult?.gitStatus) {
              mirrorGitState(finalResult.gitStatus);
            }
            if (finalResult?.evolveState) {
              mirrorEvolveState(finalResult.evolveState);
            }
            await findChangeMap();
          },
        });
      } else {
        await findChangeMap();
        useUiState.getState().setProcessing(false);
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useUiState.getState().setError(msg);
      useUiState.getState().appendLog(`✗ Error: ${msg}\n`);
      useUiState.getState().setProcessing(false);
    }
  };

  return { handleRollback };
}
