import {
  initialSummaryState,
  useWidgetStore,
  type ChangesSummary,
} from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback, useEffect } from "react";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
export function useSummary() {
  /**
   * Loads a previously cached summary from the Rust backend.
   * Only loads if the store doesn't already have a summary (to avoid overwriting in-memory data).
   */
  const loadCachedSummary = useCallback(async (): Promise<ChangesSummary | null> => {
    const { setSummary } = useWidgetStore.getState();

    const cached = await darwinAPI.summarize.getCached();
    if (cached) {
      setSummary(cached);
    }
    return cached;
  }, []);

  /**
   * Fetches a fresh AI summary of current changes.
   * Skips if already loading
   */
  const fetchSummary = useCallback(async () => {
    const { summaryLoading, setSummaryLoading, setSummary, setSummaryStale } =
      useWidgetStore.getState();

    if (summaryLoading) {
      return;
    }

    setSummaryLoading(true);
    try {
      const response = await darwinAPI.summarize.changes();
      await darwinAPI.git.statusAndCache();
      setSummary(response);
    } catch {
      // Keep existing summary on error
    } finally {
      setSummaryStale(false);
      setSummaryLoading(false);
    }
  }, []);

  /**
   * Loads cached summary on mount if the current summary is in initial state.
   */
  const useLoadCachedSummaryOnMount = () => {
    useEffect(() => {
      const { summary } = useWidgetStore.getState();
      if (JSON.stringify(summary) === JSON.stringify(initialSummaryState)) {
        loadCachedSummary();
      }
    }, []);
  };

  return { fetchSummary, loadCachedSummary, useLoadCachedSummaryOnMount };
}
