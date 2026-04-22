"use client";

import { ConfirmButton } from "@/components/widget/confirm-button";
import { ExternalBuildDetected } from "@/components/widget/external-build-detected";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useRollback } from "@/hooks/use-rollback";
import { Eraser, Wrench } from "lucide-react";

/**
 * Evolve Review Step: AI session active, not yet built.
 * Shows the diff/summary, discard and build actions, and prompt for further changes.
 */
export function EvolveStep() {
  const { handleApply } = useApply();
  const { handleRollback } = useRollback();

  return (
    <>
      <ExternalBuildDetected />
      <StepActionsHeader label="Ready to test-drive your changes?">
        <ConfirmButton
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          confirmPrefKey="confirmClear"
          onConfirm={handleRollback}
          message="Discard all current changes?"
          color="amber"
          data-testid="evolve-discard-button"
        >
          <Eraser className="h-3.5 w-3.5" />
          Discard
        </ConfirmButton>
        <ConfirmButton
          size="sm"
          className="bg-teal-600 hover:bg-teal-500 text-white"
          confirmPrefKey="confirmBuild"
          onConfirm={handleApply}
          message="Rebuild with these configuration changes?"
          color="teal"
        >
          <Wrench className="h-3.5 w-3.5" />
          Build & Test
        </ConfirmButton>
      </StepActionsHeader>
      <SummaryOrDiff />
      <PromptInputSection />
    </>
  );
}
