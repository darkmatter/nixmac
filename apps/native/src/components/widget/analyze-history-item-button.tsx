import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { useHistory } from "@/hooks/use-history";

interface AnalyzeHistoryItemButtonProps {
  hash: string;
  className?: string;
}

export function AnalyzeHistoryItemButton({ hash, className }: AnalyzeHistoryItemButtonProps) {
  const [localAnalyzing, setLocalAnalyzing] = useState(false);
  const queuedByMany = useWidgetStore((state) => state.analyzingHistoryForHashes.has(hash));
  const isAnalyzing = localAnalyzing || queuedByMany;
  const { analyzeOne } = useHistory();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isAnalyzing}
      className={cn("h-auto whitespace-nowrap border-teal-400/30 bg-teal-400/[0.08] px-[10px] py-1 text-[10px] text-neutral-400", className)}
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
          Analyzing…
        </>
      ) : (
        <>
          <Sparkles className="h-[10px] w-[10px]" />
          Analyze changes
        </>
      )}
    </Button>
  );
}
