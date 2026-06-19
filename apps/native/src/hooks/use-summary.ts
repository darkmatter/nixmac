import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { tauriAPI } from "@/ipc/api";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 * The backend commands record the recomputed map in the change-map cell;
 * `change_map_changed` mirrors it into the ViewModel.
 */
const findChangeMap = async (): Promise<void> => {
  try {
    await tauriAPI.summarizedChanges.findChangeMap();
  } catch (e) {
    console.error("[SemanticChangeMap] error", e);
  }
};

const generateCommitMessage = async () => {
  const { setCommitMessageSuggestion } = useUiState.getState();
  setCommitMessageSuggestion(null);
  try {
    const message = await tauriAPI.summarizedChanges.generateCommitMessage();
    setCommitMessageSuggestion(message);
  } catch {
    // Keep null on error — user can type manually
  }
};

const generateCurrentSummary = async () => {
  const { setSummarizing } = useUiState.getState();
  setSummarizing(true);
  try {
    await tauriAPI.summarizedChanges.summarizeCurrent();
  } finally {
    setSummarizing(false);
  }
};

const summarizeOnFocus = () => {
  if (useViewModel.getState().preferences?.autoSummarizeOnFocus) {
    generateCurrentSummary();
  }
};

export function useSummary() {
  return { findChangeMap, generateCommitMessage, generateCurrentSummary, summarizeOnFocus };
}
