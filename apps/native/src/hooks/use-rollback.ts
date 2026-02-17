import { useWidgetStore } from "@/stores/widget-store";
import { useCallback } from "react";
import { useGitOperations } from "./use-git-operations";

/**
 * Hook for rolling back changes by stashing them.
 */
export function useRollback() {
  const { refreshGitStatus, gitStash } = useGitOperations();

  const handleRollback = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "cancel");
    store.appendLog("\n> Stashing changes...\n");

    try {
      await gitStash();
      useWidgetStore.getState().appendLog("✓ Changes stashed\n");
      useWidgetStore.getState().setEvolvePrompt("");
      useWidgetStore.getState().clearPreview();
      await refreshGitStatus();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
    } finally {
      useWidgetStore.getState().setProcessing(false);
    }
  }, [refreshGitStatus, gitStash]);

  return { handleRollback };
}
