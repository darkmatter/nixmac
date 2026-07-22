import { Button } from "@/components/ui/button";
import { AnalyzeButton } from "@/components/widget/summaries/analyze-button";
import { useHistory, useHistoryQuery } from "@/hooks/use-history";
import { useUiState } from "@nixmac/state";
import { Dna, Square } from "lucide-react";

// Generates commit (if need be) and summary metadata for history items that are missing it.
export function AnalyzeHistoryButton() {
  const { history } = useHistoryQuery();
  const analyzingSize = useUiState((state) => state.analyzingHistoryForHashes.size);
  const { analyzeMany, stopAnalyzing } = useHistory();

  const recentUnsummarized = history
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.isBase)
    .slice(0, 5)
    .filter(({ item }) => !item.changeMap || item.unsummarizedHashes.length > 0)
    .map(({ item, index }) => ({ hash: item.hash, priority: index }));

  //stop only works for queued items
  if (analyzingSize > 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto whitespace-nowrap px-[10px] py-1 text-[10px] border border-red-500/30 bg-red-500/8 text-neutral-400 hover:border-red-500/60"
        onClick={stopAnalyzing}
      >
        <Square className="h-[10px] w-[10px] fill-current" />
        Stop analyzing
      </Button>
    );
  }
  if (recentUnsummarized.length > 0) {
    return (
      <AnalyzeButton
        disabled={analyzingSize === 1}
        onClick={() => analyzeMany(recentUnsummarized)}
      >
        <Dna className="h-[10px] w-[10px]" />
        Analyze recent ({recentUnsummarized.length})
      </AnalyzeButton>
    );
  }

  return null;
}
