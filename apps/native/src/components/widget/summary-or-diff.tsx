"use client";

import { Diff } from "@/components/widget/diff";
import { SummaryItems } from "@/components/widget/summary-items";
import { parseDiffIntoSections } from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { Loader2, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";

type View = "summary" | "diff";

interface SummaryOrDiffProps {
  variant?: "default" | "outline";
}

export function SummaryOrDiff({ variant = "default" }: SummaryOrDiffProps) {
  const summaryLoading = useWidgetStore((s) => s.summaryLoading);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const [activeView, setActiveView] = useState<View>("summary");

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
        <div className="inline-flex items-center gap-px rounded-md bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setActiveView("summary")}
            className={cn(
              "rounded px-3 py-1 font-medium text-xs transition-colors",
              activeView === "summary"
                ? "bg-accent text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveView("diff")}
            className={cn(
              "rounded px-3 py-1 font-medium text-xs transition-colors",
              activeView === "diff"
                ? "bg-accent text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            Diff
          </button>
        </div>
      </div>
      {summaryLoading ? (
        <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Summarizing changes...
        </div>
      ) : activeView === "diff" ? (
        <Diff diffSections={diffSections} />
      ) : (
        <SummaryItems variant={variant} diffSections={diffSections} />
      )}
    </div>
  );
}
