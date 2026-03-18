"use client";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/widget/confirm-button";
import { MergeSection } from "@/components/widget/merge-section";
import { StepActionsHeader } from "@/components/widget/step-actions-header";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { useRollback } from "@/hooks/use-rollback";
import { RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

/**
 * Commit Step component, allowing users to commit their changes, evolve further or roll back.
 */
export function MergeStep() {
  const { handleRollback } = useRollback();
  const [action, setAction] = useState<"merge" | "amend">("merge");

  return (
    <>
      <StepActionsHeader label="All changes active!">
        <ConfirmButton
          variant="ghost"
          size="sm"
          className="text-rose-400 hover:text-rose-300 hover:bg-rose-400/10"
          confirmPrefKey="confirmRollback"
          onConfirm={handleRollback}
          message="Discard changes and rebuild to previous commit?"
          color="amber"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo All
        </ConfirmButton>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setAction(action === "merge" ? "amend" : "merge")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {action === "merge" ? "Continue editing" : "Back to merge"}
        </Button>
      </StepActionsHeader>

      <SummaryOrDiff />
      {action === "merge" && <MergeSection />}
      {action === "amend" && <PromptInputSection />}
    </>
  );
}
