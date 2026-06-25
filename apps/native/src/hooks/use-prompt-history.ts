import { tauriAPI } from "@/ipc/api";

/**
 * Hook for managing prompt history.
 *
 * Adding a prompt mutates the backend, which emits `prompt_history_changed`;
 * the prompt-history sync module mirrors the payload into the ViewModel.
 */
const addToPromptHistory = async (prompt: string) => {
  // deprecated(orpc): replace with client/orpc from @/lib/orpc
  await tauriAPI.promptHistory.add(prompt).catch(console.error);
};

export function usePromptHistory() {
  return { addToPromptHistory };
}
