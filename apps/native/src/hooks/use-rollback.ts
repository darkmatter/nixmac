import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for discarding changes and restoring the working tree to HEAD.
 */
export function useRollback() {
  const handleRollback = useCallback(async () => {
    const store = useWidgetStore.getState();

    store.setProcessing(true, "cancel");
    store.appendLog("\n> Discarding changes...\n");

    try {
      const result = await darwinAPI.darwin.rollbackErase();

      store.setGitStatus(result.gitStatus);
      store.setEvolveState(result.evolveState);
      store.setEvolvePrompt("");
      store.clearPreview();
      store.appendLog("✓ Changes discarded\n");
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
    } finally {
      useWidgetStore.getState().setProcessing(false);
    }
  }, []);

  return { handleRollback };
}
