"use client";

import { AnimatedTabsList, AnimatedTabsTrigger } from "@/components/ui/animated-tabs";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { formatDriftCounts, type DriftSummaryCounts } from "./drift-utils";
import type { DriftView } from "./drift-review-types";
import { ListTree, MessageSquareText } from "lucide-react";

interface DriftReviewHeaderProps {
  counts: DriftSummaryCounts;
  isManualDrift: boolean;
  onViewChange: (view: DriftView) => void;
  view: DriftView;
}

export function DriftReviewHeader({
  counts,
  isManualDrift,
  onViewChange,
  view,
}: DriftReviewHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3  pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-semibold text-foreground text-sm">
          {isManualDrift ? "Detected changes" : "Proposed changes"}
        </span>
        <Badge variant="secondary" className="font-mono text-muted-foreground">
          {formatDriftCounts(counts)}
        </Badge>
      </div>

      <Tabs value={view} onValueChange={(value) => onViewChange(value as DriftView)}>
        <AnimatedTabsList value={view}>
          <AnimatedTabsTrigger value="summary">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
            Semantic
          </AnimatedTabsTrigger>
          <AnimatedTabsTrigger value="files">
            <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
            Diff
          </AnimatedTabsTrigger>
        </AnimatedTabsList>
      </Tabs>
    </header>
  );
}
