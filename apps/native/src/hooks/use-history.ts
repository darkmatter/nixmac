import type { HistoryItem } from "@/ipc/types";
import { orpc } from "@/lib/orpc";
import {
  clearSummarizeQueue,
  enqueueSummarize,
  type SummarizeQueueEntry,
} from "@/lib/summarize-queue";
import { uiActions, useUiState } from "@nixmac/state";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/** Page size for the infinite history query. */
export const HISTORY_PAGE_SIZE = 50;

/**
 * Paginated history backed by TanStack Query (`orpc.history.get`).
 *
 * Pages are keyed by offset; `change_map_changed` / `git_state_changed`
 * invalidate the query (see `viewmodel/history.ts`), so loaded pages refetch
 * automatically after summarize/commit/restore operations.
 */
export function useHistoryQuery() {
  const query = useInfiniteQuery(
    orpc.history.get.infiniteOptions({
      input: (pageParam: number) => ({ limit: HISTORY_PAGE_SIZE, offset: pageParam }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.hasMore ? allPages.length * HISTORY_PAGE_SIZE : undefined,
    }),
  );

  const history: HistoryItem[] = useMemo(() => {
    const pages = query.data?.pages ?? [];
    // Dedup across page boundaries: a commit landing at HEAD between fetches
    // shifts offsets, so the same hash can appear in two adjacent pages.
    const seen = new Set<string>();
    const items: HistoryItem[] = [];
    for (const page of pages) {
      for (const item of page.items) {
        if (!seen.has(item.hash)) {
          seen.add(item.hash);
          items.push(item);
        }
      }
    }
    return items;
  }, [query.data]);

  const pages = query.data?.pages;
  const total = pages?.[pages.length - 1]?.total ?? 0;

  return {
    history,
    total,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * Queue a single item for summarization at front-of-queue priority.
 * Forces past the failed-this-session guard — this is the manual retry path.
 * Progress is observable via `analyzingHistoryForHashes` in the UI store.
 */
const analyzeOne = (hash: string) => {
  enqueueSummarize([{ hash, priority: -1 }], true);
};

/**
 * Queue many items for summarization. `entries` carry each item's index in
 * the newest-first history list so the queue drains most-recent-first.
 */
const analyzeMany = (entries: SummarizeQueueEntry[]) => {
  enqueueSummarize(entries);
};

/** Stop all queued summarization (the in-flight request finishes). */
const stopAnalyzing = () => {
  clearSummarizeQueue();
  uiActions.setState({ analyzingHistoryForHashes: new Set<string>() });
};

export function useHistory() {
  return { analyzeOne, analyzeMany, stopAnalyzing };
}

/** Whether any summarize work is queued or in flight. */
export function useIsAnalyzingHistory(): boolean {
  return useUiState((state) => state.analyzingHistoryForHashes.size > 0);
}
