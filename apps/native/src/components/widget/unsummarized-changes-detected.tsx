"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { ConfigDirBadge } from "@/components/widget/config-dir-badge";
import { useWidgetStore } from "@/stores/widget-store";
import { useSummary } from "@/hooks/use-summary";

export function UnsummarizedChangesDetected() {
  const changeMap = useWidgetStore((s) => s.changeMap);
  const configDir = useWidgetStore((s) => s.configDir);
  const { generateCurrentSummary } = useSummary();
  const [isSummarizing, setIsSummarizing] = useState(false);
  const hasUnsummarized = !changeMap || changeMap.missedHashes.length > 0;

  useEffect(() => {
    setIsSummarizing(false);
  }, [changeMap]);

  if (!hasUnsummarized) {
    return null;
  }

  const handleSummarize = async () => {
    setIsSummarizing(true);
    await generateCurrentSummary();
  };

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 border-teal-300/20 border-b px-2 py-1.5 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5 flex-wrap">
        Unsummarized changes in
        <ConfigDirBadge configDir={configDir} />
      </span>
      <button
        type="button"
        onClick={handleSummarize}
        disabled={isSummarizing}
        className="flex items-center gap-1 text-teal-300 hover:text-teal-200 disabled:opacity-60"
      >
        {isSummarizing ? (
          <>
            <Spinner className="h-3 w-3" />
            summarizing…
          </>
        ) : (
          <>
            <RefreshCw className="h-3 w-3" />
            summarize
          </>
        )}
      </button>
    </div>
  );
}
