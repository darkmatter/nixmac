import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useGitOperations } from "./use-git-operations";
import { useRebuildStream } from "./use-rebuild-stream";

/**
 * Hook for discarding changes and returning to main.
 *
 * Logic:
 * 1. Restore all uncommitted changes (harmless if none exist)
 * 2. If not on main, checkout main
 * 3. If branch had a built commit, rebuild to activate main's config
 */
export function useRollback() {
  const { refreshGitStatus } = useGitOperations();
  const { triggerRebuild } = useRebuildStream();

  const handleRollback = useCallback(async () => {
    const store = useWidgetStore.getState();
    const gitStatus = store.gitStatus;
    const isOnMain = gitStatus?.isMainBranch;
    const branchHasBuiltCommit = gitStatus?.branchHasBuiltCommit;

    store.setProcessing(true, "cancel");
    store.appendLog("\n> Discarding changes...\n");

    try {
      // 1. Restore all uncommitted changes
      await darwinAPI.git.restoreAll();
      useWidgetStore.getState().appendLog("✓ Uncommitted changes restored\n");

      // 2. If not on main, checkout main (handles main vs master)
      if (!isOnMain) {
        useWidgetStore.getState().appendLog("> Checking out main...\n");
        await darwinAPI.git.checkoutMainBranch();
        useWidgetStore.getState().appendLog("✓ On main branch\n");
      }

      // Clear UI state
      useWidgetStore.getState().setEvolvePrompt("");
      useWidgetStore.getState().clearPreview();
      await refreshGitStatus();

      // 3. If branch had a built commit, rebuild to activate main's config
      if (branchHasBuiltCommit) {
        useWidgetStore.getState().appendLog("> Rebuilding to activate main configuration...\n");
        await triggerRebuild();
        // Note: processing state cleared by rebuild stream
      } else {
        useWidgetStore.getState().setProcessing(false);
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
      useWidgetStore.getState().setProcessing(false);
    }
  }, [refreshGitStatus, triggerRebuild]);

  return { handleRollback };
}
