import { AnalyzeButton } from "@/components/widget/summaries/analyze-button";
import { useHistory } from "@/hooks/use-history";
import { useUiState } from "@nixmac/state";
import { Dna, Loader2 } from "lucide-react";

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
  // The summarize queue mirrors queued/in-flight hashes into this set, so
  // membership covers both the "analyze all" flow and this button's own click.
  const isAnalyzing = useUiState((state) => state.analyzingHistoryForHashes.has(hash));
  const { analyzeOne } = useHistory();

  return (
    <AnalyzeButton
      disabled={isAnalyzing}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        analyzeOne(hash);
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
