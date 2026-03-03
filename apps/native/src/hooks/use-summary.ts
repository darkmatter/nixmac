import {
  useWidgetStore,
  type ChangesSummary,
} from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
export function useSummary() {
  /**
   * Finds the relevant summary for the current git state.
   * Looks up from DB (clean commit) or cache (uncommitted, if diff matches).
   * Does NOT generate - just finds existing ones.
   */
  const findSummary = useCallback(async (): Promise<ChangesSummary | null> => {
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

  return { generateSummary, findSummary };
}
