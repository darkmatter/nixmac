"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { useWidgetStore } from "@/stores/widget-store";
import { SummaryItems } from "@/components/widget/summary-items";
import { Diff } from "@/components/widget/diff";


interface SummaryOrDiffProps {
  variant?: "default" | "outline";
}

export function SummaryOrDiff({ variant = "default" }: SummaryOrDiffProps) {
  const summaryLoading = useWidgetStore((s) => s.summaryLoading);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const [showDiff, setShowDiff] = useState(false);


  if (!gitStatus?.diff) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex max-h-[400px] min-h-0 max-w-full shrink-0 flex-col overflow-hidden rounded-lg",
        variant === "outline" && "border border-border"
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-medium text-sm">What's Changed</h2>
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
        <Diff />
      ) : (
        <SummaryItems variant={variant} />
      )}
    </div>
  );
}
