"use client";

import { DriftBanner } from "./drift-banner";
import { DriftDiscardConfirmation } from "./drift-discard-confirmation";
import { DriftReviewActions } from "./drift-review-actions";
import { DriftReviewBuildCard } from "./drift-review-build-card";
import { DriftReviewContent } from "./drift-review-content";
import { DriftReviewHeader } from "./drift-review-header";
import type { DriftView } from "./drift-review-types";
import { deriveDriftFiles, summarizeDriftCounts } from "./drift-utils";
import { useApply } from "@/hooks/use-apply";
import { useEvolve } from "@/hooks/use-evolve";
import { useRollback } from "@/hooks/use-rollback";
import { uiActions, useUiState, useViewModel } from "@nixmac/state";
import { useEffect, useMemo, useState } from "react";

type BuildCheckStatus = "checking" | "passed" | "failed";

/**
 * Shared review surface for both the AI evolve step and the manual-drift step.
 * A card frames the uncommitted changes (summaries or the technical file list)
 * with build, discard, and refine actions. The "manual changes detected" banner
 * and the adopt-into-AI affordances only appear for true manual drift; an AI
 * session keeps its own prompt input (rendered by the step), so those are
 * suppressed here.
 */
export function DriftReview() {
  const gitStatus = useViewModel((s) => s.git);
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const evolveState = useViewModel((s) => s.evolve);
  const isApplyBusy = useUiState((s) => s.isProcessing && s.processingAction === "apply");
  const rebuildRunning = useViewModel((s) => s.rebuildStatus?.isRunning ?? false);
  const rebuildNeeded = useViewModel((s) => s.build.rebuildNeeded);

  // No active evolution → the changes are manual drift, not AI-generated.
  const isManualDrift = (evolveState?.evolutionId ?? null) === null;

  const { handleApply } = useApply();
  const { handleRollback } = useRollback();
  const { buildCheck, evolveFromManual } = useEvolve();

  const [view, setView] = useState<DriftView>("summary");
  const [dismissed, setDismissed] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [buildStatus, setBuildStatus] = useState<BuildCheckStatus>("checking");

  const changes = gitStatus?.changes;
  const files = useMemo(() => deriveDriftFiles(changes ?? []), [changes]);
  const counts = useMemo(() => summarizeDriftCounts(files), [files]);
  const isSavedBuildPending = rebuildNeeded && files.length === 0;

  // Re-run the dry build check whenever the set of changes changes.
  const changeFingerprint = useMemo(
    () => changes?.map((change) => change.hash).join(",") ?? "",
    [changes],
  );

  useEffect(() => {
    // AI-generated changes were already built during evolution, so there's no
    // dry-run gate — the build button is ready immediately (matching the prior
    // evolve step). Manual drift hasn't been built, so dry-run check it first.
    if (!isManualDrift || isSavedBuildPending) {
      setBuildStatus("passed");
      return;
    }

    let cancelled = false;
    setBuildStatus("checking");

    buildCheck()
      .then(({ passed }) => {
        if (!cancelled) setBuildStatus(passed ? "passed" : "failed");
      })
      .catch(() => {
        if (!cancelled) setBuildStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [buildCheck, changeFingerprint, isManualDrift, isSavedBuildPending]);

  if (!gitStatus) return null;

  const buildReady = buildStatus === "passed" && !isApplyBusy && !rebuildRunning;
  const buildChecking = isManualDrift && buildStatus === "checking";

  if (isSavedBuildPending) {
    return (
      <DriftReviewBuildCard
        buildReady={buildReady}
        isApplyBusy={isApplyBusy}
        rebuildRunning={rebuildRunning}
        onApply={handleApply}
      />
    );
  }

  if (files.length === 0) return null;

  const total = files.length;

  return (
    <div className="flex flex-col gap-4">
      {!dismissed && (
        <DriftBanner
          isManualDrift={isManualDrift}
          fileCount={total}
          configDir={configDir}
          onDismiss={() => setDismissed(true)}
        />
      )}

      <DriftReviewHeader
        counts={counts}
        isManualDrift={isManualDrift}
        onViewChange={setView}
        view={view}
      />

      <DriftReviewContent files={files} view={view} />

      <DriftReviewActions
        buildChecking={buildChecking}
        buildCheckFailed={buildStatus === "failed"}
        buildReady={buildReady}
        isApplyBusy={isApplyBusy}
        isManualDrift={isManualDrift}
        onApply={handleApply}
        onBackToPrompt={() => uiActions.setActiveStepOverride("begin")}
        onRefineWithAi={() => {
          void evolveFromManual();
        }}
        onRequestDiscard={() => setConfirmDiscard(true)}
        rebuildRunning={rebuildRunning}
      />

      {confirmDiscard && (
        <DriftDiscardConfirmation
          isManualDrift={isManualDrift}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            void handleRollback();
          }}
          total={total}
        />
      )}
    </div>
  );
}
