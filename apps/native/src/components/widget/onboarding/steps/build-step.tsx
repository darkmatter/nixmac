"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { InferenceSetup } from "@/components/widget/onboarding/inference/inference-setup";
import { collectTrackedCustomizationSources } from "@/components/widget/onboarding/lib/customizations";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";

// Lazy so lottie-web (and its canvas usage) stays out of the main bundle and
// the jsdom test graph — it only loads when the celebration actually shows.
const CelebrationOverlay = lazy(() =>
  import("@/components/widget/onboarding/celebration-overlay").then((m) => ({
    default: m.CelebrationOverlay,
  })),
);
import { onboardingActions, useOnboarding, useViewModel, useUiState } from "@nixmac/state";
import { ReviewStep } from "@/components/widget/steps/review-step";
import { CommitStep } from "@/components/widget/steps/commit-step";
import { EtcClobberConflictList } from "@/components/widget/overlays/etc-clobber-conflict-list";
import { useFixWithAi } from "@/hooks/use-fix-with-ai";
import { RebuildNoticeList } from "@/components/widget/overlays/rebuild-notice-list";
import { useApply } from "@/hooks/use-apply";
import { tauriAPI } from "@/ipc/api";
import { client } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { getRebuildErrorTitle, getRebuildErrorSuggestion, getRebuildSystemSafetyMessage, isAiFixableRebuildError } from "@/lib/errors";
import { getTelemetry } from "@/lib/telemetry/instance";
import type { InferenceConfig } from "@/components/widget/onboarding/lib/inference";

interface BuildStepProps {
  /** Whether AI inference is already configured. */
  hasInference: boolean;
  onConfigureInference: (config: InferenceConfig) => void;
}

type BuildStatus = "idle" | "running" | "error" | "success";

export function BuildStep({ hasInference, onConfigureInference }: BuildStepProps) {
  const { handleApply } = useApply();
  const { fixWithAi } = useFixWithAi();
  const isGenerating = useUiState((s) => s.isGenerating);
  const etcClobber = useUiState((s) => s.etcClobber);
  const evolve = useViewModel((s) => s.evolve);
  const notices = useViewModel((s) => s.rebuildLog.notices);
  const rebuildStatus = useViewModel((s) => s.rebuildStatus);
  const rawLines = useViewModel((s) => s.rebuildLog.rawLines);
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const host = useViewModel((s) => s.preferences?.hostAttr ?? "this-mac");
  const celebrating = useOnboarding((s) => s.celebrating);

  const [started, setStarted] = useState(false);
  const [dismissedCelebration, setDismissedCelebration] = useState(false);
  const [trackedOutcome, setTrackedOutcome] = useState<"success" | "error" | null>(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copying, setCopying] = useState(false);
  const currentRun = useRef(rebuildStatus);
  currentRun.current = rebuildStatus;
  useEffect(() => { setCopyFeedback(""); }, [rebuildStatus?.logFile, rebuildStatus?.isRunning]);

  async function copyLog() {
    const run = rebuildStatus;
    setCopying(true);
    setCopyFeedback("");
    try {
      if (!run?.logFile) throw new Error("The complete build log is unavailable.");
      const contents = await client.darwin.readRebuildLog({ logFile: run.logFile });
      if (!contents) throw new Error("The build log is empty.");
      if (currentRun.current?.isRunning || currentRun.current?.logFile !== run.logFile) {
        throw new Error("The build changed. Copy the log from the completed build again.");
      }
      await navigator.clipboard.writeText(contents);
      setCopyFeedback("Complete build log copied.");
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : "Could not copy the build log.");
    } finally {
      setCopying(false);
    }
  }

  const logRef = useRef<HTMLDivElement>(null);

  const command = `nix build ${configDir || "."}#darwinConfigurations.${host}.system`;

  const status: BuildStatus = rebuildStatus?.isRunning
    ? "running"
    : rebuildStatus?.success === true
      ? "success"
      : rebuildStatus?.success === false
        ? "error"
        : "idle";

  const buildStarted = started || status !== "idle";

  // Auto-scroll the log panel as lines stream in.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [rawLines]);

  // Track first build outcome once per run.
  useEffect(() => {
    if (trackedOutcome !== null) return;
    if (status === "success") {
      getTelemetry().captureEvent({ name: "first_build_completed" });
      setTrackedOutcome("success");
    } else if (status === "error") {
      getTelemetry().captureEvent({ name: "first_build_failed" });
      setTrackedOutcome("error");
    }
  }, [status, trackedOutcome]);

  // Raise the session celebration flag once the build succeeds AND inference is
  // configured. This keeps the onboarding flow mounted (showFlow) through the
  // celebration even as the durable build timestamp lands and completion
  // derives true. Dismissing it lowers the flag and routes into the app.
  useEffect(() => {
    if (status === "success" && hasInference && !dismissedCelebration && !celebrating) {
      onboardingActions.setCelebrating(true);
      getTelemetry().captureEvent({ name: "onboarding_completed" });
    }
  }, [status, hasInference, dismissedCelebration, celebrating]);

  async function applyTrackedCustomizations() {
    // Keep this outside handleApply, which is also used for ordinary rebuilds
    // after onboarding and has no customization scan context.
    const { trackedCustomizations, trackedCustomizationSources } = useOnboarding.getState();
    const trackedSources = collectTrackedCustomizationSources(
      trackedCustomizations,
      trackedCustomizationSources,
    );

    if (trackedSources.homebrew.length > 0) {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.homebrew.addItems(trackedSources.homebrew);
    }
    if (trackedSources.launchd.length > 0) {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.launchd.applyLaunchdItems(trackedSources.launchd);
    }
    if (trackedSources.systemDefaults.length > 0) {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.scanner.applyDefaults(trackedSources.systemDefaults);
    }

    // Avoid re-applying on build retries; changes are now represented in the config.
    onboardingActions.setTrackedCustomizations([], {});
  }

  // Runs the "first" build as part of onboarding. Before it can do that, it needs
  // to apply any selected "tracking" customizations.
  async function runFirstBuild() {
    setStarted(true);

    // Keep this outside handleApply, which is also used for ordinary rebuilds
    // after onboarding and has no customization scan context.
    try {
      await applyTrackedCustomizations();
    } catch (error) {
      console.error("Failed to apply tracked customizations before first build:", error);
      setStarted(false);
      setTrackedOutcome("error");
      return;
    }

    setTrackedOutcome(null);
    getTelemetry().captureEvent({ name: "first_build_started" });
    void handleApply();
  }

  return (
    <StepShell
      eyebrow={stepEyebrow("build")}
      title="Run your first build"
      description="This builds your flake and activates it on this Mac. We'll stream the logs here and help you fix anything that fails before you finish."
    >
      {/* Command + run control */}
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Build command
          </p>
          <code className="block truncate font-mono text-foreground text-sm">{command}</code>
        </div>
        {status === "idle" ? (
          <Button onClick={runFirstBuild} className="shrink-0">
            <Play className="size-4" aria-hidden="true" />
            Run build
          </Button>
        ) : status === "running" ? (
          <Button disabled className="shrink-0">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Building…
          </Button>
        ) : status === "error" ? (
          <Button onClick={runFirstBuild} className="shrink-0">
            <RotateCcw className="size-4" aria-hidden="true" />
            Retry build
          </Button>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-success/15 px-3 py-1.5 font-medium text-success text-sm">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Build succeeded
          </span>
        )}
      </div>

      {/* Terminal log panel */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex items-center gap-2 border-border border-b px-4 py-2.5">
          <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-muted-foreground text-xs">Build log</span>
          {status === "error" ? (
            <Button variant="ghost" size="sm" className="ml-auto" disabled={copying} onClick={copyLog}>
              {copying ? "Copying…" : "Copy log"}
            </Button>
          ) : null}
          {status === "running" ? (
            <Loader2
              className="ml-auto size-3.5 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <div
          ref={logRef}
          className="max-h-72 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
          aria-live="polite"
        >
          {rawLines.length === 0 ? (
            <p className="text-muted-foreground/60">Logs will appear here once the build starts.</p>
          ) : (
            rawLines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap wrap-break-word text-foreground/90",
                  /error|failed|fatal/i.test(line) && "text-destructive",
                )}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {copyFeedback ? <p role="status" className="mt-2 text-sm">{copyFeedback}</p> : null}

      <RebuildNoticeList notices={notices} />
      {status === "error" && rebuildStatus?.errorType === "etc_clobber" && etcClobber ? (
        <EtcClobberConflictList result={etcClobber} />
      ) : null}
      {evolve?.evolutionId != null && !isGenerating ? (
        evolve.step === "evolve" ? <ReviewStep /> : evolve.step === "commit" ? <CommitStep /> : null
      ) : null}

      {/* Help panel on failure */}
      {status === "error" ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <CircleAlert className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-sm">
                {rebuildStatus?.systemUntouched === false
                  ? "Activation failed"
                  : getRebuildErrorTitle(rebuildStatus?.errorType ?? undefined)}
              </p>
              <p className="text-muted-foreground text-xs">
                {getRebuildSystemSafetyMessage(rebuildStatus?.systemUntouched ?? undefined, "apply")
                  ?? (rebuildStatus?.systemUntouched === false
                    ? "Some changes may already have been applied to your Mac."
                    : "We could not confirm whether changes were made to your Mac.")}
              </p>
            </div>
          </div>
          {rebuildStatus?.errorMessage ? (
            <p className="mb-3 whitespace-pre-wrap wrap-break-word rounded-lg border border-border bg-card p-3 font-mono text-xs">
              {rebuildStatus.errorMessage}
            </p>
          ) : null}
          <p className="text-pretty text-muted-foreground text-sm">
            {getRebuildErrorSuggestion(rebuildStatus?.errorType ?? undefined)}
          </p>
          {hasInference && isAiFixableRebuildError(rebuildStatus?.errorType) && rebuildStatus?.errorMessage ? (
            <Button className="mt-3" disabled={isGenerating} onClick={() => void fixWithAi()}>
              <Sparkles className="size-4" aria-hidden="true" />
              Fix with AI
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Inference requirement — surfaces while the build runs if it was skipped
          earlier. Must be completed before finishing. */}
      {buildStarted && !hasInference ? (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-sm">
                {status === "running"
                  ? "While this builds: set up AI inference"
                  : "One more step: set up AI inference"}
              </p>
              <p className="text-muted-foreground text-xs">
                nixmac needs an inference backend before you can start making changes. Finish this
                to complete setup.
              </p>
            </div>
          </div>
          <InferenceSetup onConfigured={onConfigureInference} />
        </div>
      ) : null}

      {/* Success summary */}
      {status === "success" ? (
        <div className="mt-4 flex flex-col items-start gap-4 rounded-xl border border-success/30 bg-success/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-sm">{host} is now managed by nixmac</p>
              <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
                {hasInference
                  ? "Your first build is live. From here, every change runs through a build just like this one."
                  : "Your first build is live. Finish setting up AI inference above to open nixmac."}
              </p>
            </div>
          </div>
          <Button
            className="shrink-0"
            disabled={!hasInference}
            onClick={() => onboardingActions.setCelebrating(true)}
          >
            Open nixmac
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {celebrating ? (
        <Suspense fallback={null}>
          <CelebrationOverlay
            host={host}
            onDismiss={async () => {
              // Latch completion on the backend before lowering the celebration
              // flag: `showFlow` reads the latch, so this is the moment the
              // wizard hands over to the app. On failure keep the flow open —
              // silently dropping the latch would re-summon onboarding on the
              // next launch.
              try {
                await client.onboarding.complete();
              } catch (error) {
                console.error("[onboarding] failed to latch completion:", error);
                return;
              }
              setDismissedCelebration(true);
              onboardingActions.setCelebrating(false);
            }}
          />
        </Suspense>
      ) : null}
    </StepShell>
  );
}
