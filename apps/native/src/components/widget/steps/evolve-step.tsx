"use client";

import { ConfirmButton } from "@/components/widget/controls/confirm-button";
import { ExternalBuildDetected } from "@/components/widget/notifications/external-build-detected";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/layout/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useRollback } from "@/hooks/use-rollback";
import { Eraser, Loader2, Wrench } from "lucide-react";
import { NoiseBackground } from "@/components/ui/noise-background";
import { cn } from "@/lib/utils";

const ACTIVE_GRADIENT = ["rgb(45, 212, 191)", "rgb(20, 184, 166)", "rgb(13, 148, 136)"] as const;

const INACTIVE_GRADIENT = ["rgb(115, 115, 115)", "rgb(82, 82, 82)", "rgb(64, 64, 64)"] as const;

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

        <NoiseBackground
          animating={isBuildReady}
          shimmer={false}
          speed={isLoading ? 0.35 : 0.1}
          containerClassName={cn(
            "w-fit rounded-full p-0.5 transition-opacity duration-300",
            !isBuildReady && "opacity-70 saturate-50",
          )}
          gradientColors={isBuildReady ? [...ACTIVE_GRADIENT] : [...INACTIVE_GRADIENT]}
          noiseIntensity={isBuildReady ? 0.2 : 0.08}
        >
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
        </NoiseBackground>
      </StepActionsHeader>
      <SummaryOrDiff />
      <PromptInputSection />
    </>
  );
}
