import { uiActions, viewModelActions } from "@nixmac/state";
import { tauriAPI } from "@/ipc/api";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { getTelemetry } from "@/lib/telemetry/instance";
/**
 * Hook for discarding changes and restoring the working tree to its
 * pre-evolution state. Git/evolve/change-map state flows through the
 * `*_changed` cell events the backend emits while rolling back.
 */
export function useRollback() {
  const { triggerRebuild } = useRebuildStream();

  const handleRollback = async () => {
    const wasCommittable = viewModelActions.getState().evolve?.committable === true;

    uiActions.setProcessing(true, "cancel");
    uiActions.appendLog("\n> Discarding changes...\n");

    try {
      const result = await tauriAPI.darwin.rollbackErase();
      uiActions.setEvolvePrompt("");
      uiActions.appendLog("✓ Changes discarded\n");

      // Track rollback
      getTelemetry().captureEvent({ name: "rollback_performed" });

      if (result.rollbackStorePath && wasCommittable) {
        await triggerRebuild({
          context: "rollback",
          storePath: result.rollbackStorePath,
          onSuccess: async () => {
            await tauriAPI.darwin.finalizeRollback(
              result.rollbackStorePath,
              result.rollbackChangesetId,
            );
          },
        });
      } else {
        uiActions.setProcessing(false);
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      uiActions.setError(msg);
      uiActions.appendLog(`✗ Error: ${msg}\n`);
      uiActions.setProcessing(false);
    }
  };

  return { handleRollback };
}
