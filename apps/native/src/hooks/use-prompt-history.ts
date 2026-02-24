import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for managing prompt history.
 * Handles fetching and optionally adding prompts to history.
 */
export function usePromptHistory() {
  const refreshPromptHistory = useCallback(async (prompt?: string) => {
    if (prompt) {
      await darwinAPI.promptHistory.add(prompt).catch(console.error);
    }
    darwinAPI.promptHistory
      .get()
      .then((history) => useWidgetStore.getState().setPromptHistory(history))
      .catch(console.error);
  }, []);

  return { refreshPromptHistory };
}
