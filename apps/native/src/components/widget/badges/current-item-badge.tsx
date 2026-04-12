import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function HistoryCurrentItemBadge({ isDimmed }: { isDimmed?: boolean }) {
  return (
    <Badge
      className={cn(
        "px-[10px] py-1 text-[10px] font-bold tracking-widest",
        isDimmed
          ? "border-white/10 bg-white/[0.06] text-neutral-600 hover:bg-white/[0.06]"
          : "border-teal-400/20 bg-teal-400/10 text-teal-400 hover:bg-teal-400/10",
      )}
    >
      CURRENT
    </Badge>
  );
}
