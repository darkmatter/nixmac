import { categorizeRenamed, enrichChanges } from "@/components/widget/utils";
import {
  type DiffLineStats,
  countDiffLineStats,
} from "@/components/widget/summaries/diff-line-stats";
import type { Change, ChangeType } from "@/ipc/types";

/**
 * A per-change drift row: one independently detected hunk, its +/- line
 * stats, and its unified diff. Multiple rows may legitimately have the same
 * filename when a file contains separate semantic changes.
 */
export type DriftFileRowData = ReturnType<typeof enrichChanges>[number] & {
  hunkCount: number;
  stats: DiffLineStats;
  diffText: string;
};

export type DriftSummaryCounts = {
  added: number;
  modified: number;
  removed: number;
};

/**
 * Map an internal {@link ChangeType} to the short M/A/D/R glyph and the
 * plain-English verb shown in the drift file list.
 */
export const CHANGE_TYPE_GLYPH: Record<ChangeType, { label: string; verb: string }> = {
  new: { label: "A", verb: "Added" },
  edited: { label: "M", verb: "Updated" },
  removed: { label: "D", verb: "Removed" },
  renamed: { label: "R", verb: "Renamed" },
};

/**
 * Preserve every raw git change as a review row. A filename is display data,
 * not the identity of a semantic change, so grouping by it would make
 * unrelated hunks impossible to inspect or summarize separately.
 */
export function deriveDriftFiles(changes: Change[]): DriftFileRowData[] {
  const enriched = categorizeRenamed(enrichChanges(changes));

  return enriched.map((change) => ({
    ...change,
    hunkCount: 1,
    stats: countDiffLineStats(change.diff),
    diffText: change.diff,
  }));
}

/** Count detected changes by edit kind. Renamed files are folded into "modified". */
export function summarizeDriftCounts(files: DriftFileRowData[]): DriftSummaryCounts {
  return files.reduce<DriftSummaryCounts>(
    (acc, file) => {
      if (file.changeType === "new") acc.added += 1;
      else if (file.changeType === "removed") acc.removed += 1;
      else acc.modified += 1;
      return acc;
    },
    { added: 0, modified: 0, removed: 0 },
  );
}

/** Render the count summary badge text, e.g. `2 added · 1 modified`. */
export function formatDriftCounts(counts: DriftSummaryCounts): string {
  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.modified) parts.push(`${counts.modified} modified`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  return parts.join(" · ");
}
