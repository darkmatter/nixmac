import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useSummary } from "@/hooks/use-summary";

/**
 * Hook for git operations.
 * Provides functions for refreshing git status and stashing changes.
 */
export function useGitOperations() {
  const { loadCachedSummary } = useSummary();
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

  // runs on widget mount once, to check if summary might be stale
  const getInitialStatusAndSummary = useCallback(async () => {
    try {
      // get the summary from cache
      const summary = await loadCachedSummary();

      // get the last cached git status ()
      const cachedStatus = await darwinAPI.git.cached();
      const currentStatus = await darwinAPI.git.statusAndCache();

      // if the cache is different on mount, mark summary stale
      if (JSON.stringify(cachedStatus) !== JSON.stringify(currentStatus)) {
        useWidgetStore.getState().setSummaryStale(true);
      }
      // if there are changes but no summary, mark summary stale
      if (currentStatus?.diff && summary?.items.length === 0) {
        useWidgetStore.getState().setSummaryStale(true);
      }

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

  return { refreshGitStatus, getInitialStatusAndSummary, gitStash };
}
