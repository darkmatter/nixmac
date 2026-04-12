import type { ColorMap } from "@/components/widget/utils";
import type { ChangeWithSummary } from "@/types/shared";
import { OwnSummaryItem } from "@/components/widget/summaries/own-summary-item";
import { SummaryGroupHeader } from "@/components/widget/summaries/summary-group-header";

interface SinglesSectionProps {
  singles: ChangeWithSummary[];
  colorMap: ColorMap;
}

export function SinglesSection({ singles, colorMap }: SinglesSectionProps) {
  return (
    <div className="mt-[8px] first:mt-0">
      <SummaryGroupHeader title="Single File Changes" description="" />
      {singles.map((single) => {
        const style = colorMap.get(single.hash);
        if (!style) return null;
        return <OwnSummaryItem key={single.hash} change={single} style={style} />;
      })}
    </div>
  );
}
