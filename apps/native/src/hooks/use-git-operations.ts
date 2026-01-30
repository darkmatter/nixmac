import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for git operations.
 * Provides functions for refreshing git status and stashing changes.
 */
export function useGitOperations() {
  const refreshGitStatus = useCallback(async () => {
    try {
      const status = await darwinAPI.git.status();
      useWidgetStore.getState().setGitStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  const gitStash = useCallback(async () => {
    try {
      await darwinAPI.git.stash("stashed changes from nixmac");
      const status = await refreshGitStatus();
      return status;
    } catch {
      return null;
    }
  }, [refreshGitStatus]);

  return { refreshGitStatus, gitStash };
}
