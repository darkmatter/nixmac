import type { HistoryItem } from "@/tauri-api";
import type { ColorMap } from "@/components/widget/utils";
import { SinglesSection } from "@/components/widget/summaries/singles-section";
import { SummaryGroup } from "@/components/widget/summaries/summary-group";

interface HistoryItemExpandedDetailProps {
  item: HistoryItem;
  colorMap: ColorMap;
  expanded: boolean;
}

export function HistoryItemExpandedDetail({ item, colorMap, expanded }: HistoryItemExpandedDetailProps) {
  if (!item.changeMap || !expanded) return null;
  const { groups, singles } = item.changeMap;
  if (groups.length === 0 && singles.length === 0) return null;

  return (
    <div className="mt-[10px] border-t border-white/10 pt-[10px]">
      {groups.map((group) => (
        <SummaryGroup key={group.summary.id} group={group} colorMap={colorMap} />
      ))}
      {singles.length > 0 && (
        <SinglesSection singles={singles} colorMap={colorMap} />
      )}
    </div>
  );
}
