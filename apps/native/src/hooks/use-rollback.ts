import { useWidgetStore } from "@/stores/widget-store";
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
    const store = useWidgetStore.getState();
    const wasCommittable = useViewModel.getState().evolve?.committable === true;

    store.setProcessing(true, "cancel");
    store.appendLog("\n> Discarding changes...\n");

    try {
      const result = await tauriAPI.darwin.rollbackErase();
      mirrorGitState(result.gitStatus);
      mirrorEvolveState(result.evolveState);
      store.setEvolvePrompt("");
      store.appendLog("✓ Changes discarded\n");

      // Track rollback
      getTelemetry().captureEvent({
        name: "rollback_performed",
        props: { source: "changes" },
      });

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
        useWidgetStore.getState().setProcessing(false);
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
      useWidgetStore.getState().setProcessing(false);
    }
  };

  return { handleRollback };
}
