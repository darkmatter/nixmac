import {
  type ChangeFileSummary,
  categorizeRenamed,
  enrichChanges,
  summarizeChangesByFile,
} from "@/components/widget/utils";
import {
  type DiffLineStats,
  countDiffLineStats,
} from "@/components/widget/summaries/diff-line-stats";
import type { Change, ChangeType } from "@/ipc/types";

/** A per-file drift row: the collapsed file summary plus its summed +/- line stats. */
export type DriftFileRowData = ChangeFileSummary & { stats: DiffLineStats };

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
 * Collapse raw git changes into one row per file, carrying the summed +/- line
 * counts. `summarizeChangesByFile` discards individual hunk diffs, so the line
 * stats are accumulated from the enriched changes first and then attached.
 */
export function deriveDriftFiles(changes: Change[]): DriftFileRowData[] {
  const enriched = categorizeRenamed(enrichChanges(changes));

  const statsByFile = new Map<string, DiffLineStats>();
  for (const change of enriched) {
    const prev = statsByFile.get(change.filename) ?? { added: 0, removed: 0 };
    const next = countDiffLineStats(change.diff);
    statsByFile.set(change.filename, {
      added: prev.added + next.added,
      removed: prev.removed + next.removed,
    });
  }

  return summarizeChangesByFile(enriched).map((file) => ({
    ...file,
    stats: statsByFile.get(file.filename) ?? { added: 0, removed: 0 },
  }));
}

/** Count files by edit kind. Renamed files are folded into "modified". */
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
