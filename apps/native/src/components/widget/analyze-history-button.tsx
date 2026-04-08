import { Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWidgetStore } from "@/stores/widget-store";
import { useHistory } from "@/hooks/use-history";


// Generates commit (if need be) and summary metadata for history items that are missing it.
export function AnalyzeHistoryButton() {
  const history = useWidgetStore((state) => state.history);
  const analyzingSize = useWidgetStore((state) => state.analyzingHistoryForHashes.size);
  const { analyzeMany, stopAnalyzing } = useHistory();

  const unsummarizedHashes = history.filter((item) => !item.changeMap).map((item) => item.hash);

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
  if (unsummarizedHashes.length > 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        // disabled for analysis in progress
        disabled={analyzingSize === 1}
        className="h-auto whitespace-nowrap px-[10px] py-1 text-[10px] border border-teal-400/30 bg-teal-400/[0.08] text-neutral-400 hover:border-teal-400/60"
        onClick={() => analyzeMany(unsummarizedHashes)}
      >
        <Sparkles className="h-[10px] w-[10px]" />
        Analyze missing change data
      </Button>
    );
  }

  return null;
}
