import { Badge } from "@/components/ui/badge";
import type { ChangeWithRichType } from "@/components/widget/utils";
import { useWidgetStore } from "@/stores/widget-store";

function getDiffBody(diff: string): string[] {
  const lines = diff.split("\n");
  const hunkStart = lines.findIndex((l) => l.startsWith("@@"));
  return hunkStart >= 0 ? lines.slice(hunkStart + 1) : [];
}

function countAddedRemoved(diff: string): { added: number; removed: number } {
  const body = getDiffBody(diff);
  let added = 0;
  let removed = 0;
  for (const line of body) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

interface HunkPillProps {
  change: ChangeWithRichType;
  onClick: () => void;
}

// Badge shown in a file header for a single change: displays the summary title if available, otherwise +N/-M counts. Clicking scrolls the diff editor to that hunk.
export function HunkPill({ change, onClick }: HunkPillProps) {
  const changeMap = useWidgetStore((s) => s.changeMap);

  let summaryTitle: string | null = null;
  if (changeMap) {
    for (const group of changeMap.groups) {
      const match = group.changes.find((c) => c.hash === change.hash);
      if (match) { summaryTitle = match.title; break; }
    }
    if (!summaryTitle) {
      const match = changeMap.singles.find((c) => c.hash === change.hash);
      if (match) summaryTitle = match.title;
    }
  }

  const { added, removed } = countAddedRemoved(change.diff);
  const showCounts = change.changeType === "edited" || change.changeType === "renamed";
  const label = summaryTitle
    ?? (showCounts ? [added && `+${added}`, removed && `-${removed}`].filter(Boolean).join(" ") : null);

  if (!label) return null;

  return (
    <Badge
      variant="secondary"
      className="max-w-[140px] cursor-pointer truncate rounded-full border-none font-mono text-[10px] text-[#888] tracking-wide transition-all hover:brightness-110"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
    >
      {label}
    </Badge>
  );
}