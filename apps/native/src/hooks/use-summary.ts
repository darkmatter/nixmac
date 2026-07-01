import { client } from "@/lib/orpc";
import { uiActions, viewModelActions } from "@nixmac/state";

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

const generateCommitMessage = async (options?: { clear?: boolean }) => {
  const clear = options?.clear ?? true;
  if (clear) {
    uiActions.setCommitMessageSuggestion(null);
  }
  try {
    const message = await client.summarizedChanges.generateCommitMessage();
    uiActions.setCommitMessageSuggestion(message);
  } catch {
    // Keep existing on error — user can type manually
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
