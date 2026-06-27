"use client";

import { GlowFrame } from "@/components/button-glow";
import { ConfirmButton } from "@/components/widget/controls/confirm-button";
import { ExternalBuildDetected } from "@/components/widget/notifications/external-build-detected";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/layout/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useEvolve } from "@/hooks/use-evolve";
import { cn } from "@/lib/utils";
import { useViewModel } from "@nixmac/state";
import { useUiState } from "@nixmac/state";
import { Loader2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type BuildCheckStatus = "checking" | "passed" | "failed";

/**
 * Manual Evolve Step: uncommitted changes present, not yet built.
 * Shows the file list, a build action, and a prompt that auto-adopts changes into AI evolution.
 */
export function ManualEvolveStep() {
  const { handleApply } = useApply();
  const { buildCheck } = useEvolve();
  const gitStatus = useViewModel((s) => s.git);
  const isApplyBusy = useUiState((s) => s.isProcessing && s.processingAction === "apply");
  const rebuildRunning = useViewModel((s) => s.rebuildStatus?.isRunning ?? false);
  const [buildStatus, setBuildStatus] = useState<BuildCheckStatus>("checking");

  const changeFingerprint = useMemo(
    () => gitStatus?.changes.map((c) => c.hash).join(",") ?? "",
    [gitStatus?.changes],
  );

  useEffect(() => {
    let cancelled = false;
    setBuildStatus("checking");

    buildCheck()
      .then(({ passed }) => {
        if (!cancelled) {
          setBuildStatus(passed ? "passed" : "failed");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBuildStatus("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [buildCheck, changeFingerprint]);

  const buildReady = buildStatus === "passed" && !isApplyBusy && !rebuildRunning;
  const buildChecking = buildStatus === "checking";

  return (
    <>
      <ExternalBuildDetected />
      <StepActionsHeader label="Uncommitted changes">
        <GlowFrame active={buildReady}>
          <ConfirmButton
            size="sm"
            disabled={!buildReady}
            className={cn(
              "rounded-full border-0 shadow-none transition-all duration-100",
              buildReady
                ? "bg-slate-900 text-slate-300 hover:bg-slate-800 active:scale-[0.98]"
                : "cursor-not-allowed bg-slate-800/80 text-slate-500 hover:bg-slate-800/80",
            )}
            confirmPrefKey="confirmBuild"
            onConfirm={handleApply}
            message="Rebuild with these configuration changes?"
            color="teal"
          >
            {buildChecking ? (
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
