import { tauriAPI } from "@/ipc/api";
import { useUiStore } from "@/stores/ui-store";

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
    .then((history) => useUiStore.getState().setPromptHistory(history))
    .catch(console.error);
};

export function usePromptHistory() {
  return { refreshPromptHistory };
}
