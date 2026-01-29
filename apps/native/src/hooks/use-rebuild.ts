import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for handling rebuild overlay operations.
 * Provides rollback and dismiss handlers for the rebuild overlay.
 */
export function useRebuild() {
  const handleRollback = useCallback(async () => {
    try {
      await darwinAPI.git.restoreAll();
      useWidgetStore.getState().clearRebuild();
    } catch (e) {
      console.error("Failed to rollback:", e);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    useWidgetStore.getState().clearRebuild();
  }, []);

  return { handleRollback, handleDismiss };
}
