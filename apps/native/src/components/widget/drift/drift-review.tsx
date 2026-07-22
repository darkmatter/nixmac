"use client";

import { AnimatedTabsList, AnimatedTabsTrigger } from "@/components/ui/animated-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs } from "@/components/ui/tabs";
import { ConfirmButton } from "@/components/widget/controls/confirm-button";
import { useApply } from "@/hooks/use-apply";
import { useEvolve } from "@/hooks/use-evolve";
import { useRollback } from "@/hooks/use-rollback";
import { uiActions, useUiState, useViewModel } from "@nixmac/state";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  GitCommitHorizontal,
  ListTree,
  Loader2,
  MessageSquareText,
  Sparkles,
  Trash2,
  Wrench,
  CircleCheckBig,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DriftBanner } from "./drift-banner";
import { DriftFileRow } from "./drift-file-row";
import { DriftSummaryView } from "./drift-summary-view";
import { deriveDriftFiles, formatDriftCounts, summarizeDriftCounts } from "./drift-utils";

type BuildCheckStatus = "checking" | "passed" | "failed";
type DriftView = "summary" | "files";

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
    () => changes?.map((c) => c.hash).join(",") ?? "",
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

  if (isSavedBuildPending) {
    return (
      <div className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card/50 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-teal-500/10 p-2 text-teal-500">
            <CircleCheckBig className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="font-semibold text-foreground">New configuration updates are available</h2>
            <p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
              This Mac isn’t using the latest configuration yet. Apply the updates to bring it up to date.
            </p>
          </div>
        </div>

        <footer className="flex justify-end border-border/60 border-t pt-4">
          <ConfirmButton
            size="sm"
            disabled={!buildReady}
            confirmPrefKey="confirmBuild"
            onConfirm={handleApply}
            message="Build and apply your saved configuration?"
            color="teal"
          >
            {rebuildRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {rebuildRunning ? "Building…" : "Build & Test"}
          </ConfirmButton>
        </footer>
      </div>
    );
  }

  if (files.length === 0) return null;

  const total = files.length;
  const buildChecking = isManualDrift && buildStatus === "checking";

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

      <header className="flex items-center justify-between gap-3  pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-foreground text-sm">
            {isManualDrift ? "Detected changes" : "Proposed changes"}
          </span>
          <Badge variant="secondary" className="font-mono text-muted-foreground">
            {formatDriftCounts(counts)}
          </Badge>
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as DriftView)}>
          <AnimatedTabsList value={view}>
            <AnimatedTabsTrigger value="summary">
              <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
              Semantic
            </AnimatedTabsTrigger>
            <AnimatedTabsTrigger value="files">
              <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
              Diff
            </AnimatedTabsTrigger>
          </AnimatedTabsList>
        </Tabs>
      </header>

      <div>
        {view === "summary" ? (
          <DriftSummaryView />
        ) : (
          <ul className="divide-y divide-border/50">
            {files.map((file, index) => (
              <DriftFileRow
                key={`${file.oldFilename ?? ""}\0${file.filename}`}
                file={file}
                defaultOpen={index === 0}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-border/60 border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmDiscard(true)}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Discard
        </Button>

        <div className="flex items-center gap-2">
          {/* AI session: refine by returning to the Describe step, which keeps
                the prompt + the live conversation. (Manual drift has no
                conversation — it refines via the "Refine with AI" combo item.) */}
          {!isManualDrift && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => uiActions.setActiveStepOverride("begin")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to Prompt
            </Button>
          )}
          <div className="flex items-center">
            <ConfirmButton
              size="sm"
              disabled={!buildReady}
              className={isManualDrift ? "rounded-r-none" : ""}
              confirmPrefKey="confirmBuild"
              onConfirm={handleApply}
              message="Rebuild with these configuration changes?"
              color="teal"
            >
              {buildChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {buildChecking ? "Checking…" : "Build & Test"}
            </ConfirmButton>
            {/* The split dropdown only adopts manual drift into an AI session.
                An active AI session refines via the "Refine with AI" button. */}
            {isManualDrift && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    aria-label="More build options"
                    className="rounded-l-none border-primary-foreground/20 border-l px-2"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-56">
                  <DropdownMenuItem
                    onSelect={() => {
                      void evolveFromManual();
                    }}
                  >
                    <Sparkles />
                    <span>
                      Refine with AI first
                      <span className="block text-[10px] text-muted-foreground">
                        Adopt these changes into an AI session
                      </span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <GitCommitHorizontal />
                    <span>
                      Commit without building
                      <span className="block text-[10px] text-muted-foreground">
                        Track as-is, skip rebuild — coming soon
                      </span>
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </footer>

      {confirmDiscard && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="text-foreground text-sm">
            Discard all {total} {isManualDrift ? "manual " : ""}
            {total === 1 ? "change" : "changes"}? This reverts to the tracked state and cannot be
            undone.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDiscard(false)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmDiscard(false);
                handleRollback();
              }}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
