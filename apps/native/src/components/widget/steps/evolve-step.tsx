"use client";

import { ConfirmButton } from "@/components/widget/controls/confirm-button";
import { ExternalBuildDetected } from "@/components/widget/notifications/external-build-detected";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/layout/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useRollback } from "@/hooks/use-rollback";
import { Eraser, Loader2, Wrench } from "lucide-react";
import { GlowFrame } from "@/components/button-glow";
import { cn } from "@/lib/utils";

/**
 * Evolve Review Step: AI session active, not yet built.
 * Shows the diff/summary, discard and build actions, and prompt for further changes.
 */
export function EvolveStep() {
  const { handleApply } = useApply();
  const { handleRollback } = useRollback();
  const isLoading = false;
  const isBuildReady = true;

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

        <GlowFrame active={isBuildReady}>
          <ConfirmButton
            size="sm"
            disabled={!isBuildReady}
            className={cn(
              "rounded-full border-0 shadow-none transition-all duration-100",
              isBuildReady
                ? "bg-slate-900 text-slate-300 hover:bg-slate-800 active:scale-[0.98]"
                : "cursor-not-allowed bg-slate-800/80 text-slate-500 hover:bg-slate-800/80",
            )}
            confirmPrefKey="confirmBuild"
            onConfirm={handleApply}
            message="Rebuild with these configuration changes?"
            color="teal"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            Build & Test
          </ConfirmButton>
        </GlowFrame>
      </StepActionsHeader>
      <SummaryOrDiff />
      <PromptInputSection />
    </>
  );
}
