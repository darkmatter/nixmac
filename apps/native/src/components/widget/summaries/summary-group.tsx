import type { ColorMap } from "@/components/widget/utils";
import type { SemanticChangeGroup } from "@/types/shared";
import { OwnSummaryItem } from "@/components/widget/summaries/own-summary-item";
import { SummaryGroupHeader } from "@/components/widget/summaries/summary-group-header";

interface SummaryGroupProps {
  group: SemanticChangeGroup;
  colorMap: ColorMap;
}

export function SummaryGroup({ group, colorMap }: SummaryGroupProps) {
  const style = colorMap.get(String(group.summary.id));
  if (!style) return null;
  return (
    <div className="mt-[8px] first:mt-0">
      <SummaryGroupHeader title={group.summary.title} description={group.summary.description} />
      {group.changes.map((change) => (
        <OwnSummaryItem key={change.hash} change={change} style={style} />
      ))}
    </div>
  );
}
