import { AnalyzeButton } from "@/components/widget/summaries/analyze-button";
import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import { Dna, Loader2 } from "lucide-react";
import { useState } from "react";
interface AnalyzeHistoryItemButtonProps {
  hash: string;
  isPartial?: boolean;
  className?: string;
}

export function AnalyzeHistoryItemButton({
  hash,
  isPartial,
  className,
}: AnalyzeHistoryItemButtonProps) {
  const [localAnalyzing, setLocalAnalyzing] = useState(false);
  const queuedByMany = useWidgetStore((state) =>
    state.analyzingHistoryForHashes.has(hash),
  );
  const isAnalyzing = localAnalyzing || queuedByMany;
  const { analyzeOne } = useHistory();

  return (
    <AnalyzeButton
      disabled={isAnalyzing}
      className={className}
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
    </AnalyzeButton>
  );
}
