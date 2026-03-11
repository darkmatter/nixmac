import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

interface HistoryHeaderProps {
  count: number;
  onGenerateAll: (() => void) | null;
}

export function HistoryHeader({ count, onGenerateAll }: HistoryHeaderProps) {
  return (
    <div className="grid grid-cols-2 items-center border-b border-[#2a2a2a] pb-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-neutral-500" />
        <h2 className="text-md font-semibold">History</h2>
        <span className="rounded-full bg-white/10 px-2 text-xs mt-[2px] font-semibold text-neutral-400">
          {count}
        </span>
      </div>
      <div className="flex justify-end">
        {onGenerateAll && (
          <Button
            type="button"
            size="sm"
            className="bg-teal-600 text-white hover:bg-teal-500"
            onClick={onGenerateAll}
          >
            Generate 10
          </Button>
        )}
      </div>
    </div>
  );
}
