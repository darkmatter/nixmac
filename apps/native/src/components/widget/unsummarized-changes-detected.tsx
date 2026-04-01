"use client";

import { RefreshCw } from "lucide-react";
import { ConfigDirBadge } from "@/components/widget/config-dir-badge";
import { useWidgetStore } from "@/stores/widget-store";
import { useSummary } from "@/hooks/use-summary";

export function UnsummarizedChangesDetected() {
  const changeMap = useWidgetStore((s) => s.changeMap);
  const configDir = useWidgetStore((s) => s.configDir);
  const { generateCurrentSummary } = useSummary();
  const hasUnsummarized = !changeMap || changeMap.missedHashes.length > 0;

  if (!hasUnsummarized) {
    return null;
  }

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 border-teal-300/20 border-b px-2 py-1.5 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5 flex-wrap">
        Unsummarized changes in
        <ConfigDirBadge configDir={configDir} />
      </span>
      <button
        type="button"
        onClick={generateCurrentSummary}
        className="flex items-center gap-1 text-teal-300 hover:text-teal-200"
      >
        <RefreshCw className="h-3 w-3" />
        summarize
      </button>
    </div>
  );
}
