"use client";

import { ArrowLeft, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { getChangeType } from "./utils";
import { getDirectory, getShortFilename } from "@/components/widget/utils";

interface SummaryItemsProps {
  variant?: "default" | "outline";
}

export function SummaryItems({ variant = "default" }: SummaryItemsProps) {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const summary = useWidgetStore((s) => s.summary);

  const changedFiles = gitStatus?.files || [];
  const summaryItems = summary.items;

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

  // Show AI summary items if available, otherwise show file list
  if (summaryItems.length > 0) {
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {changedFiles.map((f) => {
        const changeType = getChangeType(f);
        const fileName = getShortFilename(f.path);
        const directory = getDirectory(f.path);
        const isStaged = Boolean(
          f.index && f.index !== " " && f.index !== "?"
        );

        return renderListItem({
          key: f.path,
          changeType,
          fileName,
          directory,
          isStaged,
        });
      })}
    </div>
  );
}
