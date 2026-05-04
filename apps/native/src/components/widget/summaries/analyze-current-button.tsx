"use client";

import { AnalyzeButton } from "@/components/widget/summaries/analyze-button";
import { useSummary } from "@/hooks/use-summary";
import { useWidgetStore } from "@/stores/widget-store";
import { Dna, Loader2 } from "lucide-react";

export function AnalyzeCurrentButton() {
  const isSummarizing = useWidgetStore((s) => s.isSummarizing);
  const { generateCurrentSummary } = useSummary();

  return (
    <AnalyzeButton onClick={generateCurrentSummary} disabled={isSummarizing}>
      {isSummarizing ? (
        <>
          <Loader2 className="h-[10px] w-[10px] animate-spin" />
          Analyzing…
        </>
      ) : (
        <>
          <Dna className="h-[10px] w-[10px]" />
          Analyze
        </>
      )}
    </AnalyzeButton>
  );
}
