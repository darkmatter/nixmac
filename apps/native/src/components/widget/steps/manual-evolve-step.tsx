"use client";

import { NoiseBackground } from "@/components/ui/noise-background";
import { ConfirmButton } from "@/components/widget/controls/confirm-button";
import { ExternalBuildDetected } from "@/components/widget/notifications/external-build-detected";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { StepActionsHeader } from "@/components/widget/layout/step-actions-header";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useEvolve } from "@/hooks/use-evolve";
import { cn } from "@/lib/utils";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { Loader2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const ACTIVE_GRADIENT = [
  "rgb(45, 212, 191)",
  "rgb(20, 184, 166)",
  "rgb(13, 148, 136)",
] as const;

const INACTIVE_GRADIENT = [
  "rgb(115, 115, 115)",
  "rgb(82, 82, 82)",
  "rgb(64, 64, 64)",
] as const;

type BuildCheckStatus = "checking" | "passed" | "failed";

/**
 * Manual Evolve Step: uncommitted changes present, not yet built.
 * Shows the file list, a build action, and a prompt that auto-adopts changes into AI evolution.
 */
export function ManualEvolveStep() {
  const { handleApply } = useApply();
  const { buildCheck } = useEvolve();
  const gitStatus = useViewModel((s) => s.git);
  const isApplyBusy = useWidgetStore(
    (s) => s.isProcessing && s.processingAction === "apply",
  );
  const rebuildRunning = useViewModel((s) => s.rebuild.isRunning);
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

  const buildReady =
    buildStatus === "passed" && !isApplyBusy && !rebuildRunning;
  const buildChecking = buildStatus === "checking";

  return (
    <>
      <ExternalBuildDetected />
      <StepActionsHeader label="Uncommitted changes">
        <NoiseBackground
          animating={buildReady}
          shimmer={buildReady}
          speed={buildReady ? 0.35 : 0.1}
          containerClassName={cn(
            "w-fit rounded-full p-0.5 transition-opacity duration-300",
            !buildReady && "opacity-70 saturate-50",
          )}
          gradientColors={
            buildReady ? [...ACTIVE_GRADIENT] : [...INACTIVE_GRADIENT]
          }
          noiseIntensity={buildReady ? 0.2 : 0.08}
        >
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
        </NoiseBackground>
      </StepActionsHeader>
      <SummaryOrDiff />
      <PromptInputSection />
    </>
  );
}
