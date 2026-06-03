import { Badge } from "@/components/ui/badge";
import type { ChangeWithRichType } from "@/components/widget/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { countDiffLineStats, DiffLineStatsBadge } from "./diff-line-stats";

interface HunkPillProps {
  change: ChangeWithRichType;
  showCounts?: boolean;
  onClick: () => void;
}

// Clicking a hunk pill opens the file and scrolls the diff editor to that hunk.
export function HunkPill({ change, showCounts = true, onClick }: HunkPillProps) {
  const changeMap = useWidgetStore((s) => s.changeMap);

  let summaryTitle: string | null = null;
  if (changeMap) {
    for (const group of changeMap.groups) {
      const match = group.changes.find((c) => c.hash === change.hash);
      if (match) {
        summaryTitle = match.title;
        break;
      }
    }
    if (!summaryTitle) {
      const match = changeMap.singles.find((c) => c.hash === change.hash);
      if (match) summaryTitle = match.title;
    }
  }

  const stats = countDiffLineStats(change.diff);
  const label = summaryTitle;

  if (!label && (!showCounts || (stats.added === 0 && stats.removed === 0))) {
    return null;
  }

  return (
    <Badge
      variant="secondary"
      className="max-w-[140px] cursor-pointer truncate rounded-full border-none font-mono text-[10px] text-[#888] tracking-wide transition-all hover:brightness-110"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label ?? `${stats.added} additions, ${stats.removed} deletions`}
    >
      {label ?? <DiffLineStatsBadge stats={stats} />}
    </Badge>
  );
}