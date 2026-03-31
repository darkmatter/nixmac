import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
export function useSummary() {
  const findChangeMap = useCallback(async (): Promise<void> => {
    const { setChangeMap, setSummaryAvailable } = useWidgetStore.getState();
    try {
      const map = await darwinAPI.summarizedChanges.findChangeMap();
      if (map) {
        setChangeMap(map);
        setSummaryAvailable(map.groups.length > 0 || map.singles.length > 0);
      }
    } catch (e) {
      console.error("[SemanticChangeMap] error", e);
    }
  }, []);

  const generateCommitMessage = useCallback(async () => {
    const { setCommitMessageSuggestion } = useWidgetStore.getState();
    setCommitMessageSuggestion(null);
    try {
      const message = await darwinAPI.summarizedChanges.generateCommitMessage();
      setCommitMessageSuggestion(message);
    } catch {
      // Keep null on error — user can type manually
    }
  }, []);

  const generateCurrentSummary = useCallback(async () => {
    await darwinAPI.summarizedChanges.summarizeCurrent();
  }, []);

  return { findChangeMap, generateCommitMessage, generateCurrentSummary };
}
