"use client";

import { ConfirmButton } from "@/components/widget/confirm-button";
import { GetStartedMessage } from "@/components/widget/get-started-message";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useRollback } from "@/hooks/use-rollback";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { Eraser, Undo2, Wrench } from "lucide-react";

/**
 * Evolve Step has two states:.
 *   - "begin"    → GetStartedMessage (idle, no active evolution)
 *   - "evolving" → action header with Discard / Build&Test buttons
 */
export function EvolveStep() {
  const step = useCurrentStep();
  const evolveState = useWidgetStore((s) => s.evolveState);
  const { handleApply } = useApply();
  const { handleRollback } = useRollback();

  const isBegin = step === "begin";

  const needsRebuild = evolveState != null && evolveState.changesetAtBuild !== null;

  const clearIcon = needsRebuild ? <Undo2 className="h-3.5 w-3.5" /> : <Eraser className="h-3.5 w-3.5" />;
  const clearLabel = needsRebuild ? "Undo All" : "Discard";
  const clearMessage = needsRebuild ? "Discard changes and rebuild to previous state?" : "Discard all current changes?";

  const header = () => {
    if (isBegin) return <GetStartedMessage />;
    return (
      <StepActionsHeader label="Ready to test-drive your changes?">
        <ConfirmButton
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          confirmPrefKey="confirmClear"
          onConfirm={handleRollback}
          message={clearMessage}
          color="amber"
        >
          {clearIcon}
          {clearLabel}
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
    );
  };

  return (
    <>
      {header()}
      <SummaryOrDiff />
      <PromptInputSection />
    </>
  );
}
