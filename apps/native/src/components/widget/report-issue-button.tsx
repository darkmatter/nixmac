"use client";

import { Button } from "@/components/ui/button";
import { useWidgetStore } from "@/stores/widget-store";
import { FeedbackType } from "@/types/feedback";

export function ReportIssueButton() {
  const openFeedback = useWidgetStore((s) => s.openFeedback);

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
