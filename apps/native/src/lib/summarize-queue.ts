// Serial queue for history summarization (`history.generateFrom`).
//
// The backend summarizes one commit per call and each call costs a model
// request, so requests are buffered and drained strictly one at a time.
// Priority is recency: entries carry the item's index in the newest-first
// history list, and the drain loop always picks the lowest index — so the
// visible (newest) commits summarize before lookahead ones, even when new
// entries arrive mid-drain.
//
// Per-item failures are skipped, not fatal: one flaky model response must not
// abort a long backfill. The user can retry any item via its Analyze button.

import { client } from "@/lib/orpc";
import { invalidateHistory } from "@/viewmodel/history";
import { uiActions, useUiState } from "@nixmac/state";

/** hash → priority (history index; lower = newer = drained first). */
const pending = new Map<string, number>();
/**
 * Hashes that failed once this session. The lazy enqueuer re-runs on every
 * history refetch, so without this guard a persistently-failing item would
 * retry in a loop. Manual retries (`force`) clear the mark.
 */
const failed = new Set<string>();
let draining = false;

export type SummarizeQueueEntry = {
  hash: string;
  /** Index of the item in the newest-first history list. */
  priority: number;
};

/**
 * Add entries to the queue (deduplicated by hash, keeping the best priority)
 * and start draining if idle. Safe to call repeatedly with overlapping sets —
 * e.g. on every visible-range change.
 *
 * Entries that already failed this session are skipped unless `force` is set
 * (used by the per-item Analyze button for explicit retries).
 */
export function enqueueSummarize(entries: SummarizeQueueEntry[], force = false): void {
  for (const { hash, priority } of entries) {
    if (failed.has(hash)) {
      if (!force) continue;
      failed.delete(hash);
    }
    const existing = pending.get(hash);
    if (existing === undefined || priority < existing) {
      pending.set(hash, priority);
    }
    uiActions.addAnalyzingHistoryHash(hash);
  }
  void drain();
}

/** Clear all queued (not-yet-started) work and its pending-state badges. */
export function clearSummarizeQueue(): void {
  for (const hash of pending.keys()) {
    uiActions.removeAnalyzingHistoryHash(hash);
  }
  pending.clear();
}

/** Number of entries waiting in the queue (excluding the in-flight one). */
export function summarizeQueueSize(): number {
  return pending.size;
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.size > 0) {
      const hash = takeNewest();
      if (!hash) break;
      // The user may have hit "Stop analyzing", which clears the UI set —
      // treat missing membership as a cancellation for this hash.
      if (!useUiState.getState().analyzingHistoryForHashes.has(hash)) continue;
      try {
        await client.history.generateFrom({ commitHash: hash, number: 1 });
      } catch (error) {
        // Skip and continue: log for diagnosis but keep the backfill going.
        console.warn(`[summarize-queue] failed for ${hash}, skipping:`, error);
        failed.add(hash);
      } finally {
        uiActions.removeAnalyzingHistoryHash(hash);
      }
      // Backfills of old commits don't reliably emit `change_map_changed`
      // (the working-tree map is unchanged), so refresh explicitly.
      invalidateHistory();
    }
  } finally {
    draining = false;
  }
}

/** Remove and return the pending hash with the lowest priority (newest). */
function takeNewest(): string | undefined {
  let bestHash: string | undefined;
  let bestPriority = Number.POSITIVE_INFINITY;
  for (const [hash, priority] of pending) {
    if (priority < bestPriority) {
      bestPriority = priority;
      bestHash = hash;
    }
  }
  if (bestHash !== undefined) pending.delete(bestHash);
  return bestHash;
}
