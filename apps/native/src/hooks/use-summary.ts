import { useWidgetStore, type ChangesSummary } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 * Returns functions to load cached summaries and check/fetch if needed.
 */
export function useSummary() {
  /**
   * Loads a previously cached summary from the Rust backend.
   * Only loads if the store doesn't already have a summary (to avoid overwriting in-memory data).
   * Returns the cached summary if loaded, or null if skipped/unavailable.
   */
  const loadCachedSummary = useCallback(async (): Promise<ChangesSummary | null> => {
    const store = useWidgetStore.getState();

    // Don't override if we already have a summary in memory
    if (store.summary.items.length > 0) {
      return null;
    }

    const cached = await darwinAPI.summarize.getCached();
    if (cached) {
      useWidgetStore.getState().setSummary(cached);
    }
    return cached;
  }, []);

  /**
   * Checks if the summary needs to be fetched (empty or stale) and fetches if needed.
   */
  const checkAndFetchSummary = useCallback(async ({ skipCheck = false } = {}) => {
    const store = useWidgetStore.getState();

    if (!store.gitStatus?.hasChanges) {
      return;
    }

    // Consider the summary empty/stale if:
    // 1. No summary items AND no diff content
    // 2. File count doesn't match between summary and current git status
    const summaryEmpty = store.summary.items.length === 0 && !store.summary.diff;
    const summaryStale =
      !summaryEmpty &&
      store.gitStatus.files &&
      store.summary.filesChanged !== store.gitStatus.files.length;

    const shouldFetch = skipCheck || summaryEmpty || summaryStale;

    if (shouldFetch) {
      store.setSummaryLoading(true);
      try {
        const response = await darwinAPI.summarize.changes();
        store.setSummary(response);
      } catch {
        // Keep existing summary on error
      } finally {
        store.setSummaryLoading(false);
      }
    }
  }, []);

  return { checkAndFetchSummary, loadCachedSummary };
}
