import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { useSummary } from "@/hooks/use-summary";

/**
 * Hook for discarding changes and restoring the working tree to its pre-evolution state.
 */
export function useRollback() {
  const { triggerRebuild } = useRebuildStream();
  const { findChangeMap } = useSummary();

  const handleRollback = useCallback(async () => {
    const store = useWidgetStore.getState();
    const wasCommittable = store.evolveState?.committable === true;

    store.setProcessing(true, "cancel");
    store.appendLog("\n> Discarding changes...\n");

    try {
      const result = await darwinAPI.darwin.rollbackErase();
      store.setGitStatus(result.gitStatus);
      store.setEvolveState(result.evolveState);
      store.setEvolvePrompt("");
      store.clearPreview();
      store.appendLog("✓ Changes discarded\n");

      const storePathForRebuild = result.rollbackStorePath;
      if (storePathForRebuild && wasCommittable) {
        await triggerRebuild({
          context: "rollback",
          storePath: storePathForRebuild,
          onSuccess: async () => {
            const finalResult = await darwinAPI.darwin.finalizeRollback(
              storePathForRebuild,
              result.rollbackStorePath ? result.rollbackChangesetId : null,
            );
            if (finalResult?.gitStatus) {
              useWidgetStore.getState().setGitStatus(finalResult.gitStatus);
            }
            if (finalResult?.evolveState) {
              useWidgetStore.getState().setEvolveState(finalResult.evolveState);
            }
          },
        });
      }
      await findChangeMap();
      useWidgetStore.getState().setProcessing(false);
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
      useWidgetStore.getState().setProcessing(false);
    }
  }, [triggerRebuild, findChangeMap]);

  return { handleRollback };
}
