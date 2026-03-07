"use client";

import { ConfirmButton } from "@/components/widget/confirm-button";
import { GetStartedMessage } from "@/components/widget/get-started-message";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useRollback } from "@/hooks/use-rollback";
import { useWidgetStore } from "@/stores/widget-store";
import { Eraser, Undo2, Wrench } from "lucide-react";

/**
 * Evolve Step component, allowing users to plan, apply, or clear configuration changes.
 */
export function EvolveStep() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const { handleApply } = useApply();
  const { handleRollback } = useRollback();

  if (!gitStatus) return null;

  const cleanOnMain = gitStatus.cleanHead && gitStatus.isMainBranch;
  const needsRebuild = !gitStatus.isMainBranch && gitStatus.branchHasBuiltCommit;

  const clearIcon = needsRebuild ? <Undo2 className="h-3.5 w-3.5" /> : <Eraser className="h-3.5 w-3.5" />;
  const clearLabel = needsRebuild ? "Undo All" : "Discard";
  const clearMessage = needsRebuild ? "Discard changes and rebuild to previous state?" : "Discard all current changes?";

  const header = () => {
    if (cleanOnMain) return <GetStartedMessage />;
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
