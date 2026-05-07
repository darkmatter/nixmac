import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
export function useSummary() {
  const autoSummarizeOnFocus = useWidgetStore((s) => s.autoSummarizeOnFocus);

  const findChangeMap = useCallback(async (): Promise<void> => {
    const { setChangeMap } = useWidgetStore.getState();
    try {
      const map = await darwinAPI.summarizedChanges.findChangeMap();
      if (map) {
        setChangeMap(map);
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
    const { setSummarizing, setChangeMap } = useWidgetStore.getState();
    setSummarizing(true);
    try {
      const map = await darwinAPI.summarizedChanges.summarizeCurrent();
      setChangeMap(map);
    } finally {
      setSummarizing(false);
    }
  }, []);

  const summarizeOnFocus = useCallback(() => {
    if (autoSummarizeOnFocus) generateCurrentSummary();
  }, [autoSummarizeOnFocus, generateCurrentSummary]);

  return { findChangeMap, generateCommitMessage, generateCurrentSummary, summarizeOnFocus };
}
