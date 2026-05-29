import { tauriAPI } from "@/ipc/api";
import { usePrefStore } from "@/stores/pref-store";
import { useWidgetStore } from "@/stores/widget-store";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
const findChangeMap = async (): Promise<void> => {
  const { setChangeMap } = useWidgetStore.getState();
  try {
    const map = await tauriAPI.summarizedChanges.findChangeMap();
    if (map) {
      setChangeMap(map);
    }
  } catch (e) {
    console.error("[SemanticChangeMap] error", e);
  }
};

const generateCommitMessage = async () => {
  const { setCommitMessageSuggestion } = useWidgetStore.getState();
  setCommitMessageSuggestion(null);
  try {
    const message = await tauriAPI.summarizedChanges.generateCommitMessage();
    setCommitMessageSuggestion(message);
  } catch {
    // Keep null on error — user can type manually
  }
};

const generateCurrentSummary = async () => {
  const { setSummarizing, setChangeMap } = useWidgetStore.getState();
  setSummarizing(true);
  try {
    const map = await tauriAPI.summarizedChanges.summarizeCurrent();
    setChangeMap(map);
  } finally {
    setSummarizing(false);
  }
};

const summarizeOnFocus = () => {
  if (usePrefStore.getState().autoSummarizeOnFocus) {
    generateCurrentSummary();
  }
};

export function useSummary() {
  return {
    findChangeMap,
    generateCommitMessage,
    generateCurrentSummary,
    summarizeOnFocus,
  };
}
