import { cn } from "@/lib/utils";
import { LINE_LABEL, LINE_UNDONE } from "./timeline-connector";

interface HistoryDayLabelProps {
  label: string;
  isFirst: boolean;
  isUndone: boolean;
}

export function HistoryDayLabel({ label, isFirst, isUndone }: HistoryDayLabelProps) {
  return (
    <div className="relative flex gap-2">
      {!isFirst && (
        <div
          className={cn(
            "absolute top-0 bottom-0 left-[5px] w-0.5",
            isUndone ? LINE_UNDONE : LINE_LABEL,
          )}
        />
      )}
      <div className={cn("w-3 flex-none ml-2", isUndone && "ml-6")} />
      <p className="mt-1 px-0.5 pb-[6px] pt-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-neutral-500">
        {label}
      </p>
    </div>
  );
}
