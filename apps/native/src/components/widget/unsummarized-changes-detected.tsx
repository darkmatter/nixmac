"use client";

import { ConfigDirBadge } from "@/components/widget/config-dir-badge";
import { AnalyzeCurrentButton } from "@/components/widget/summaries/analyze-current-button";
import { useWidgetStore } from "@/stores/widget-store";

export function UnsummarizedChangesDetected() {
  const configDir = useWidgetStore((s) => s.configDir);
  const changeMap = useWidgetStore((s) => s.changeMap);
  if (!changeMap) return null;
  const hasUnsummarized = changeMap?.unsummarizedHashes.length
  if (!hasUnsummarized) return null
  const hasSummaries = changeMap.groups.length || changeMap.singles.length


  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 px-2 py-1.5 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5 flex-wrap">
        {hasSummaries ? "Also in" : "Manual Changes found in"}
        <ConfigDirBadge configDir={configDir} />
        :
        <AnalyzeCurrentButton />
      </span>
    </div>
  );
}
