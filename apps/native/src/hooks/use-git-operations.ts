import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Hook for git operations.
 * Provides functions for refreshing git status and stashing changes.
 */
export function useGitOperations() {
  const refreshGitStatus = useCallback(
    async (options?: { cache?: boolean }) => {
      try {
        const shouldCache = options?.cache === true;
        const status = shouldCache
          ? await darwinAPI.git.statusAndCache()
          : await darwinAPI.git.status();

        useWidgetStore.getState().setGitStatus(status);

        return status;
      } catch {
        return null;
      }
    },
    [],
  );

  // runs on widget mount once, to get the current git status
  const getInitialStatus = useCallback(async () => {
    try {
      const currentStatus = await darwinAPI.git.statusAndCache();
      useWidgetStore.getState().setGitStatus(currentStatus);
    } catch {
      return null;
    }
  }, []);

  const gitStash = useCallback(
    async () => {
      try {
        await darwinAPI.git.stash("stashed changes from nixmac");
        const status = await refreshGitStatus();
        return status;
      } catch {
        return null;
      }
    },
    [refreshGitStatus],
  );

  const handleMerge = useCallback(
    async (squash = false, commitMessage?: string) => {
      const store = useWidgetStore.getState();
      const currentBranch = store.gitStatus?.branch;

      if (!currentBranch) {
        return;
      }

      store.setProcessing(true, "merge");
      store.appendLog(`\n> Merging ${currentBranch} to main...\n`);

      try {
        await darwinAPI.git.mergeBranch(currentBranch, squash, commitMessage);
        useWidgetStore.getState().appendLog("✓ Merged successfully\n");
        useWidgetStore.getState().setError(null);
        toast.success("Merged successfully", { description: `${currentBranch} merged to main` });
        useWidgetStore.getState().setCommitMsg("");
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
    },
    [refreshGitStatus],
  );

  return { refreshGitStatus, getInitialStatus, gitStash, handleMerge };
}
