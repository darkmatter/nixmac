import { useState } from "react";
import { Dna, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { useHistory } from "@/hooks/use-history";
interface AnalyzeHistoryItemButtonProps {
  hash: string;
  isPartial?: boolean;
  className?: string;
}

export function AnalyzeHistoryItemButton({ hash, isPartial, className }: AnalyzeHistoryItemButtonProps) {
  const [localAnalyzing, setLocalAnalyzing] = useState(false);
  const queuedByMany = useWidgetStore((state) => state.analyzingHistoryForHashes.has(hash));
  const isAnalyzing = localAnalyzing || queuedByMany;
  const { analyzeOne } = useHistory();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isAnalyzing}
      className={cn("h-auto gap-[3px] px-[7px] py-0.5 text-[10px] text-neutral-500 hover:bg-transparent hover:text-neutral-300", className)}
      onClick={async (e) => {
        e.stopPropagation();
        setLocalAnalyzing(true);
        try {
          await analyzeOne(hash);
        } finally {
          setLocalAnalyzing(false);
        }
      }}
    >
      {isAnalyzing ? (
        <>
          <Loader2 className="h-[10px] w-[10px] animate-spin" />
          {isPartial ? "Updating…" : "Analyzing…"}
        </>
      ) : (
        <>
          <Dna className="h-[10px] w-[10px]" />
          {isPartial ? "Update" : "Analyze"}
        </>
      )}
    </Button>
  );
}
