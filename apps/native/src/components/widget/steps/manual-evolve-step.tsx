"use client";

import { ConfirmButton } from "@/components/widget/confirm-button";
import { ExternalBuildDetected } from "@/components/widget/external-build-detected";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { Wrench } from "lucide-react";

/**
 * Manual Evolve Step: uncommitted changes present, not yet built.
 * Shows the file list, a build action, and a prompt that auto-adopts changes into AI evolution.
 */
export function ManualEvolveStep() {
  const { handleApply } = useApply();

  return (
    <>
      <ExternalBuildDetected />
      <StepActionsHeader label="Uncommitted changes">
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
