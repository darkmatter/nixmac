"use client";

import { StaleSummaryNotice } from "@/components/widget/stale-summary-notice";
import {
  getChangeTypeFromChunks,
  getDirectory,
  getShortFilename,
  type FileDiff,
} from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { ArrowLeft, Check, Pencil, Plus, Trash2 } from "lucide-react";

interface SummaryItemsProps {
  variant?: "default" | "outline";
  diffSections: FileDiff[];
}

export function SummaryItems({ variant = "default", diffSections }: SummaryItemsProps) {
  const summary = useWidgetStore((s) => s.summary);
  const summaryAvailable = useWidgetStore((s) => s.summaryAvailable);
  const summaryItems = summary.items;
  console.log(summary)

  const renderListItem = ({
    key,
    changeType,
    fileName,
    directory,
    isStaged,
  }: {
    key: string;
    changeType: "new" | "edited" | "removed" | "renamed";
    fileName: string;
    directory?: string;
    isStaged?: boolean;
  }) => (
    <div
      className={cn(
        "flex max-w-full items-center gap-3 py-4",
        variant === "outline" && "border-border/50 border-b last:border-b-0"
      )}
      key={key}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          changeType === "new" && "bg-green-500/15 text-green-400",
          changeType === "edited" && "bg-amber-500/15 text-amber-400",
          changeType === "removed" && "bg-red-500/15 text-red-400",
          changeType === "renamed" && "bg-blue-500/15 text-blue-400"
        )}
      >
        {changeType === "new" && <Plus className="h-4 w-4" />}
        {changeType === "edited" && <Pencil className="h-4 w-4" />}
        {changeType === "removed" && <Trash2 className="h-4 w-4" />}
        {changeType === "renamed" && <ArrowLeft className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{fileName}</p>
        {directory && (
          <p className="truncate text-muted-foreground text-xs">{directory}</p>
        )}
      </div>
      {isStaged && <Check className="h-4 w-4 shrink-0 text-green-400" />}
    </div>
  );

  if (!summaryAvailable || summaryItems.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StaleSummaryNotice />
        {diffSections.map((section) =>
          renderListItem({
            key: section.filename,
            changeType: getChangeTypeFromChunks(section.chunks),
            fileName: getShortFilename(section.filename),
            directory: getDirectory(section.filename),
          })
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {summaryItems.map((item, index) =>
        renderListItem({
          key: `summary-${index}`,
          changeType: "edited",
          fileName: item.title,
          directory: item.description,
        })
      )}
    </div>
  );
}
