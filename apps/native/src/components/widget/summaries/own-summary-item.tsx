import type { CategoryStyle } from "@/components/widget/utils";
import { getShortFilename } from "@/components/widget/utils";
import type { ChangeWithSummary } from "@/types/shared";
import { cn } from "@/lib/utils";

interface OwnSummaryItemProps {
  change: ChangeWithSummary;
  style: CategoryStyle;
}

export function OwnSummaryItem({ change, style }: OwnSummaryItemProps) {
  return (
    <div className={cn("my-[3px] rounded border-l-2 bg-white/[0.02] px-2 py-1 text-[11px]", style.border)}>
      <span className="text-neutral-400">{change.title || getShortFilename(change.filename)}</span>
      {change.description && (
        <span className="text-neutral-500"> — {change.description}</span>
      )}
    </div>
  );
}
