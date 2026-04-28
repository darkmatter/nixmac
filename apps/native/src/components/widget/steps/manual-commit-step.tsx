"use client";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/widget/confirm-button";
import { MergeSection } from "@/components/widget/merge-section";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useRollback } from "@/hooks/use-rollback";
import { useWidgetStore } from "@/stores/widget-store";
import { RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

/**
 * Manual Commit Step: uncommitted changes present, built and ready to commit.
 */
export function ManualCommitStep() {
  const { handleRollback } = useRollback();
  const built = useWidgetStore((s) => s.evolveState?.committable);
  const rollbackStorePath = useWidgetStore((s) => s.evolveState?.rollbackStorePath);
  const [action, setAction] = useState<"commit" | "amend">("commit");

  return (
    <>
      <StepActionsHeader label="All changes active!">
        {built && rollbackStorePath && (
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
            Undo last build
          </ConfirmButton>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setAction(action === "commit" ? "amend" : "commit")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {action === "commit" ? "Continue editing" : "Back to commit"}
        </Button>
      </StepActionsHeader>
      <SummaryOrDiff />
      {action === "commit" && <MergeSection />}
      {action === "amend" && <PromptInputSection />}
    </>
  );
}
