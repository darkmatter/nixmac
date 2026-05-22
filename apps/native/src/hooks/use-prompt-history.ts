import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/tauri-api";

/**
 * Hook for managing prompt history.
 * Handles fetching and optionally adding prompts to history.
 */
const refreshPromptHistory = async (prompt?: string) => {
  if (prompt) {
    await tauriAPI.promptHistory.add(prompt).catch(console.error);
  }
  tauriAPI.promptHistory
    .get()
    .then((history) => useWidgetStore.getState().setPromptHistory(history))
    .catch(console.error);
};

export function usePromptHistory() {
  return { refreshPromptHistory };
}
