import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 * Returns a function to check and fetch the summary if needed.
 * Includes logging to verify it only fetches when necessary.
 */
export function useSummary() {
  const checkAndFetchSummary = useCallback(async (skipCheck = false) => {
    const store = useWidgetStore.getState();

    if (!store.gitStatus?.hasChanges) {
      return;
    }

    // Consider the summary empty/stale if:
    // 1. No summary items AND no diff content
    // 2. File count doesn't match between summary and current git status
    const summaryEmpty =
      store.summary.items.length === 0 && !store.summary.diff;
    const summaryStale =
      !summaryEmpty &&
      store.gitStatus.files &&
      store.summary.filesChanged !== store.gitStatus.files.length;

    const shouldFetch = skipCheck || summaryEmpty || summaryStale;

    if (shouldFetch) {
      store.setSummary({ isLoading: true });
      try {
        const response = await darwinAPI.summarize.changes();

        store.setSummary({
          items: response.items,
          instructions: response.instructions,
          commitMessage: response.commitMessage,
          filesChanged: response.filesChanged,
          additions: response.additions,
          deletions: response.deletions,
          diff: response.diff,
          isLoading: false,
        });
      } catch {
        store.setSummary({ isLoading: false });
      }
    }
  }, []);

  return { checkAndFetchSummary };
}
