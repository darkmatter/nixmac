import { cn } from "@/lib/utils";

export type DiffLineStats = {
  added: number;
  removed: number;
};

export function countDiffLineStats(diff: string): DiffLineStats {
  let added = 0;
  let removed = 0;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }

  return { added, removed };
}

export function sumDiffLineStats(changes: Array<{ diff: string }>): DiffLineStats {
  return changes.reduce<DiffLineStats>(
    (total, change) => {
      const stats = countDiffLineStats(change.diff);
      total.added += stats.added;
      total.removed += stats.removed;
      return total;
    },
    { added: 0, removed: 0 },
  );
}

interface DiffLineStatsBadgeProps {
  stats: DiffLineStats;
  className?: string;
}

export function DiffLineStatsBadge({ stats, className }: DiffLineStatsBadgeProps) {
  if (stats.added === 0 && stats.removed === 0) return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-mono text-[10px] leading-none",
        className,
      )}
      title={`${stats.added} additions, ${stats.removed} deletions`}
    >
      {stats.added > 0 && (
        <span className="font-semibold text-emerald-400">+{stats.added}</span>
      )}
      {stats.removed > 0 && (
        <span className="font-semibold text-red-400">-{stats.removed}</span>
      )}
    </span>
  );
}
