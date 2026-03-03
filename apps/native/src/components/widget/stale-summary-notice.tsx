"use client";

import { FolderOpen, RefreshCw } from "lucide-react";
import { getShortFilename } from "@/components/widget/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { useSummary } from "@/hooks/use-summary";

export function StaleSummaryNotice() {
  const summaryAvailable = useWidgetStore((s) => s.summaryAvailable);
  const summaryLoading = useWidgetStore((s) => s.summaryLoading);
  const configDir = useWidgetStore((s) => s.configDir);
  const setSummaryAvailable = useWidgetStore((s) => s.setSummaryAvailable);
  const { generateSummary } = useSummary();

  if (summaryAvailable || summaryLoading) {
    return null;
  }

  const dirName = getShortFilename(configDir) || "config";

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSummaryAvailable(true);
  };

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 border-teal-300/20 border-b px-2 py-1.5 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5 flex-wrap">
        Manual changes found in
        <code className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono">
          <FolderOpen className="h-3 w-3" />
          {dirName}
        </code>
        — <span className="underline">change info may be outdated</span>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </span>
      <button
        type="button"
        onClick={generateSummary}
        className="flex items-center gap-1 text-teal-300 hover:text-teal-200"
      >
        <RefreshCw className="h-3 w-3" />
        refresh
      </button>
    </div>
  );
}
