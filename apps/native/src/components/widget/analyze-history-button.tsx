import { Dna, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWidgetStore } from "@/stores/widget-store";
import { useHistory } from "@/hooks/use-history";


// Generates commit (if need be) and summary metadata for history items that are missing it.
export function AnalyzeHistoryButton() {
  const history = useWidgetStore((state) => state.history);
  const analyzingSize = useWidgetStore((state) => state.analyzingHistoryForHashes.size);
  const { analyzeMany, stopAnalyzing } = useHistory();

  const recentUnsummarizedHashes = history
    .filter((item) => !item.isBase)
    .slice(0, 5)
    .filter((item) => !item.changeMap || item.missedHashes.length > 0)
    .map((item) => item.hash);

  //stop only works for queued items
  if (analyzingSize > 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto whitespace-nowrap px-[10px] py-1 text-[10px] border border-red-500/30 bg-red-500/[0.08] text-neutral-400 hover:border-red-500/60"
        onClick={stopAnalyzing}
      >
        <Square className="h-[10px] w-[10px] fill-current" />
        Stop analyzing
      </Button>
    );
  }
  if (recentUnsummarizedHashes.length > 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={analyzingSize === 1}
        className="h-auto gap-[3px] px-[7px] py-0.5 text-[10px] text-neutral-500 hover:bg-transparent hover:text-neutral-300"
        onClick={() => analyzeMany(recentUnsummarizedHashes)}
      >
        <Dna className="h-[10px] w-[10px]" />
        Analyze recent ({recentUnsummarizedHashes.length})
      </Button>
    );
  }

  return null;
}
