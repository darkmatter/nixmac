import { useUiState } from "@/stores/ui-state";
import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import { mirrorChangeMapState } from "@/viewmodel/change-map";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
const findChangeMap = async (): Promise<void> => {
  try {
    const map = await tauriAPI.summarizedChanges.findChangeMap();
    if (map) {
      mirrorChangeMapState(map);
    }
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
    const map = await tauriAPI.summarizedChanges.summarizeCurrent();
    mirrorChangeMapState(map);
  } finally {
    setSummarizing(false);
  }
};

const summarizeOnFocus = () => {
  if (useWidgetStore.getState().autoSummarizeOnFocus) {
    generateCurrentSummary();
  }
};

export function useSummary() {
  return { findChangeMap, generateCommitMessage, generateCurrentSummary, summarizeOnFocus };
}
