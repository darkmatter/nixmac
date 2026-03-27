import {
  useWidgetStore,
  type SummaryResponse,
} from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
export function useSummary() {
  /**
   * Finds the relevant summary for the current git state.
   */
  const findSummary = useCallback(async (): Promise<SummaryResponse | null> => {
    const { setSummary, summaryLoading, setSummaryLoading, setSummaryAvailable } = useWidgetStore.getState();

    if (summaryLoading) {
      return null;
    }

    const available = await darwinAPI.summary.find();
    if (available) {
      setSummary(available);
      setSummaryAvailable(true);
      setSummaryLoading(false);
    }
    return available;
  }, []);

  /**
   * Fetches a fresh AI summary of current changes.
   * Skips if already loading
   */
  const generateSummary = useCallback(async () => {
    const { summaryLoading, setSummaryLoading, setSummary, setSummaryAvailable } =
      useWidgetStore.getState();

    if (summaryLoading) {
      return;
    }

    setSummaryLoading(true);
    try {
      const response = await darwinAPI.summary.generate();
      await darwinAPI.git.statusAndCache();
      setSummary(response);
    } catch {
      // Keep existing summary on error
    } finally {
      setSummaryAvailable(true);
      setSummaryLoading(false);
    }
  }, []);

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
    } finally {
    }
  }, []);

  const generateCurrentSummary = useCallback(async () => {
    await darwinAPI.summarizedChanges.summarizeCurrent();
  }, []);

  return { generateSummary, findSummary, findChangeMap, generateCommitMessage, generateCurrentSummary };
}
