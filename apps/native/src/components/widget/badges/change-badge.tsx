import { cn } from "@/lib/utils";
import type { CategoryStyle } from "@/components/widget/utils";

const SHIMMER_WIDTHS = [48, 56, 44];

interface ChangeBadgeProps {
  title: string;
  style: CategoryStyle | undefined;
  index: number;
}

export function ChangeBadge({ title, style, index }: ChangeBadgeProps) {
  if (!title) {
    return (
      <span
        className="inline-block h-[18px] rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-white/[0.03] via-white/[0.065] to-white/[0.03]"
        style={{ width: `${SHIMMER_WIDTHS[index % SHIMMER_WIDTHS.length]}px` }}
      />
    );
  }

  if (!style) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[3px] rounded px-[7px] py-0.5 text-[10px]",
        style.text,
        style.bg,
      )}
    >
      <span className={cn("h-[5px] w-[5px] shrink-0 rounded-full", style.dot)} />
      {title}
    </span>
  );
}
