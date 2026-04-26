import { Clock } from "lucide-react";
import { AnalyzeHistoryButton } from "@/components/widget/analyze-history-button";

interface HistoryHeaderProps {
  count: number;
}

export function HistoryHeader({ count }: HistoryHeaderProps) {
  return (
    <div className="grid grid-cols-2 items-center border-b border-[#2a2a2a] pb-3 mr-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-neutral-500" />
        <h2 className="text-md font-semibold">History</h2>
        <span
          className="rounded-full bg-white/10 px-2 text-xs mt-[2px] font-semibold text-neutral-400"
          data-testid="history-count-badge"
        >
          {count}
        </span>
      </div>
      <div className="flex justify-end">
        <AnalyzeHistoryButton />
      </div>
    </div>
  );
}
