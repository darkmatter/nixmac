import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";

/**
 * Hook for discarding changes and restoring the working tree to HEAD.
 * If the last build matches the running system, rebuilds after discarding
 * to sync the running system with the restored HEAD files.
 */
export function useRollback() {
  const { triggerRebuild } = useRebuildStream();

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

      if (wasCommittable) {
        await triggerRebuild({
          context: "rollback",
          onSuccess: async () => {
            await darwinAPI.darwin.finalizeApply();
          },
        });
      } else {
        useWidgetStore.getState().setProcessing(false);
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
      useWidgetStore.getState().setProcessing(false);
    }
  }, [triggerRebuild]);

  return { handleRollback };
}
