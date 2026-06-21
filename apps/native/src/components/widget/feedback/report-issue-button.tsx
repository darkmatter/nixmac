"use client";

import { Button } from "@/components/ui/button";
import { useUiState } from "@nixmac/state";
import { FeedbackType } from "@/types/feedback";

export function ReportIssueButton() {
  const openFeedback = useUiState((s) => s.openFeedback);

  return (
    <div className="mt-auto flex justify-center py-2">
      <Button
        variant="link"
        size="sm"
        className="text-muted-foreground text-xs"
        onClick={() => openFeedback(FeedbackType.Issue)}
      >
        Report Issue
      </Button>
    </div>
  );
}
