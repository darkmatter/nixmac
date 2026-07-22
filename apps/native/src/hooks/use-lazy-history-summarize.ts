// Visibility-driven lazy summarization for the history timeline.
//
// Watches which history cards are in the viewport (IntersectionObserver) and
// enqueues unsummarized items within the visible range plus LOOKAHEAD_ITEMS
// beyond it. The serial queue drains newest-first, so on-screen commits are
// summarized before lookahead ones. Also drives infinite-scroll pagination:
// when the viewport nears the end of loaded pages, the next page is fetched.

import type { HistoryItem } from "@/ipc/types";
import { enqueueSummarize } from "@/lib/summarize-queue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Items to summarize beyond the visible range ("a page or two beyond"). */
const LOOKAHEAD_ITEMS = 10;

/** Fetch the next history page when fewer than this many items remain below. */
const PAGE_FETCH_THRESHOLD = 10;

function needsSummarize(item: HistoryItem): boolean {
  if (item.isBase || item.isUndone || item.isOrphanedRestore) return false;
  // Restore commits inherit their origin's summary; nothing to generate.
  if (item.originHash) return false;
  return !item.changeMap || item.unsummarizedHashes.length > 0;
}

export function useLazyHistorySummarize({
  history,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  history: HistoryItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  // hash → visible, maintained by one shared IntersectionObserver.
  const visibleHashesRef = useRef(new Set<string>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [visibleVersion, setVisibleVersion] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (observed) => {
        let changed = false;
        for (const entry of observed) {
          const hash = (entry.target as HTMLElement).dataset.historyHash;
          if (!hash) continue;
          const has = visibleHashesRef.current.has(hash);
          if (entry.isIntersecting && !has) {
            visibleHashesRef.current.add(hash);
            changed = true;
          } else if (!entry.isIntersecting && has) {
            visibleHashesRef.current.delete(hash);
            changed = true;
          }
        }
        if (changed) setVisibleVersion((v) => v + 1);
      },
      // Root null = window viewport; the widget is a single-window app so the
      // ScrollArea viewport and window viewport coincide vertically.
      { rootMargin: "100px 0px" },
    );
    observerRef.current = observer;
    const visibleHashes = visibleHashesRef.current;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      visibleHashes.clear();
    };
  }, []);

  /** Ref callback for each history card wrapper; requires data-history-hash. */
  const observeItem = useCallback((node: HTMLElement | null) => {
    if (node) observerRef.current?.observe(node);
    // Unobserve happens implicitly on disconnect; per-node cleanup uses the
    // callback-ref contract (React calls with null on unmount).
  }, []);

  const indexByHash = useMemo(() => {
    const map = new Map<string, number>();
    history.forEach((item, i) => map.set(item.hash, i));
    return map;
  }, [history]);

  // React to visibility / data changes: enqueue summarize work + paginate.
  useEffect(() => {
    if (history.length === 0) return;

    const visibleIndices = [...visibleHashesRef.current]
      .map((hash) => indexByHash.get(hash))
      .filter((i): i is number => i !== undefined);
    if (visibleIndices.length === 0) return;

    const firstVisible = Math.min(...visibleIndices);
    const lastVisible = Math.max(...visibleIndices);
    const rangeEnd = Math.min(history.length - 1, lastVisible + LOOKAHEAD_ITEMS);

    const entries = [];
    for (let i = firstVisible; i <= rangeEnd; i++) {
      const item = history[i];
      if (needsSummarize(item)) {
        entries.push({ hash: item.hash, priority: i });
      }
    }
    if (entries.length > 0) enqueueSummarize(entries);

    // Infinite scroll: pull the next page when the lookahead window runs
    // past the loaded items.
    if (hasNextPage && !isFetchingNextPage && lastVisible + PAGE_FETCH_THRESHOLD >= history.length) {
      fetchNextPage();
    }
  }, [visibleVersion, history, indexByHash, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return { observeItem };
}
