"use client";

import { FolderOpen, RefreshCw } from "lucide-react";
import { getShortFilename } from "@/components/widget/utils";
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

  const dirName = getShortFilename(configDir) || "config";

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 border-teal-300/20 border-b px-2 py-1.5 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5 flex-wrap">
        Unsummarized changes in
        <code className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono">
          <FolderOpen className="h-3 w-3" />
          {dirName}
        </code>
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
