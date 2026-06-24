"use client";

import { Button } from "@/components/ui/button";
import { uiActions } from "@nixmac/state";
import { FeedbackType } from "@/types/feedback";

export function ReportIssueButton() {
  
  return (
    <div className="mt-auto flex justify-center py-2">
      <Button
        variant="link"
        size="sm"
        className="text-muted-foreground text-xs"
        onClick={() => uiActions.openFeedback(FeedbackType.Issue)}
      >
        Report Issue
      </Button>
    </div>
  );
}
