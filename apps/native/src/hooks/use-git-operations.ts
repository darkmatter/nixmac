import { loadHosts } from "@/hooks/use-widget-initialization";
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
      } catch (e: unknown) {
        const msg = (e as Error)?.message || String(e);
        useWidgetStore.getState().setError(msg);
        if (msg.includes("is not a git repository")) {
          useWidgetStore.getState().setHosts([]);
        } else {
          await loadHosts();
        }
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
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      if (msg.includes("is not a git repository")) {
        useWidgetStore.getState().setHosts([]);
      } else {
        await loadHosts();
      }
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

  const handleCommit = useCallback(
    async ({ message }: { message: string }) => {
      const store = useWidgetStore.getState();
      store.setProcessing(true, "merge");
      store.appendLog(`\n> Committing changes...\n`);

      try {
        const result = await darwinAPI.git.commit(message);
        useWidgetStore.getState().appendLog("✓ Committed successfully\n");
        useWidgetStore.getState().setError(null);
        toast.success("Committed successfully");
        useWidgetStore.getState().clearPreview();
        useWidgetStore.getState().setEvolveState(result.evolveState);
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

  return { refreshGitStatus, getInitialStatus, gitStash, handleCommit };
}
