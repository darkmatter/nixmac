import { uiActions, viewModelActions } from "@nixmac/state";
import { client } from "@/lib/orpc";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 * The backend commands record the recomputed map in the change-map cell;
 * `change_map_changed` mirrors it into the ViewModel.
 */
const findChangeMap = async (): Promise<void> => {
  try {
    await client.summarizedChanges.findChangeMap();
  } catch (e) {
    console.error("[SemanticChangeMap] error", e);
  }
};

const generateCommitMessage = async () => {
  uiActions.setCommitMessageSuggestion(null);
  try {
    const message = await client.summarizedChanges.generateCommitMessage();
    uiActions.setCommitMessageSuggestion(message);
  } catch {
    // Keep null on error — user can type manually
  }
};

const generateCurrentSummary = async () => {
  uiActions.setSummarizing(true);
  try {
    await client.summarizedChanges.summarizeCurrent();
  } finally {
    uiActions.setSummarizing(false);
  }
};

const summarizeOnFocus = () => {
  if (viewModelActions.getState().preferences?.autoSummarizeOnFocus) {
    generateCurrentSummary();
  }
};

export function useSummary() {
  return { findChangeMap, generateCommitMessage, generateCurrentSummary, summarizeOnFocus };
}
