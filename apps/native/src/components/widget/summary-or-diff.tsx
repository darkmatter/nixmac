"use client";

import { Switch } from "@/components/ui/switch";
import { Diff } from "@/components/widget/diff";
import { SummaryItems } from "@/components/widget/summary-items";
import { parseDiffIntoSections } from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { Loader2, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";

interface SummaryOrDiffProps {
  variant?: "default" | "outline";
}

export function SummaryOrDiff({ variant = "default" }: SummaryOrDiffProps) {
  const summaryLoading = useWidgetStore((s) => s.summaryLoading);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const [showDiff, setShowDiff] = useState(false);

  const cleanOnMain = gitStatus?.cleanHead && gitStatus?.isMainBranch;

  if (!gitStatus || cleanOnMain) {
    return null;
  }

  const diffSections = parseDiffIntoSections(gitStatus.diff || "");

  return (
    <div
      className={cn(
        "flex max-h-[400px] min-h-0 max-w-full shrink-0 flex-col overflow-hidden rounded-lg",
        variant === "outline" && "border border-border"
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          {gitStatus.headIsBuilt ? <Wrench className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
          <h2 className="font-medium text-sm">{gitStatus.headIsBuilt ? "Active Changes" : "What's changed"}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {showDiff ? "Diff" : "Summary"}
          </span>
          <Switch checked={showDiff} onCheckedChange={setShowDiff} />
        </div>
      </div>
      {summaryLoading ? (
        <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Summarizing changes...
        </div>
      ) : showDiff ? (
        <Diff diffSections={diffSections} />
      ) : (
        <SummaryItems variant={variant} diffSections={diffSections} />
      )}
    </div>
  );
}
