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
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { InferenceSetup } from "@/components/widget/onboarding/inference/inference-setup";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";

// Lazy so lottie-web (and its canvas usage) stays out of the main bundle and
// the jsdom test graph — it only loads when the celebration actually shows.
const CelebrationOverlay = lazy(() =>
  import("@/components/widget/onboarding/celebration-overlay").then((m) => ({
    default: m.CelebrationOverlay,
  })),
);
import type { InferenceConfig } from "@/components/widget/onboarding/lib/inference";
import { useApply } from "@/hooks/use-apply";
import { useViewModel } from "@nixmac/state";
import { cn } from "@/lib/utils";
import { getTelemetry } from "@/lib/telemetry/instance";

interface BuildStepProps {
  /** Whether AI inference is already configured. */
  hasInference: boolean;
  onConfigureInference: (config: InferenceConfig) => void;
  /** Called when the user finishes onboarding from the success screen. */
  onComplete: () => void;
}

type BuildStatus = "idle" | "running" | "error" | "success";

/** Common first-build failures surfaced as quick fixes. */
const FIXES = [
  {
    title: "Typo in a package or option name",
    detail:
      "An unknown attribute (like a misspelled package) is the most common first-build failure. Nix points to the file and line — open it and fix the highlighted spot.",
  },
  {
    title: "Stale flake inputs",
    detail: "Run nix flake update to refresh pinned inputs, then rebuild.",
  },
  {
    title: "Uncommitted changes",
    detail: "Nix only sees committed files in a flake. Commit your changes, then retry.",
  },
];

export function BuildStep({ hasInference, onConfigureInference, onComplete }: BuildStepProps) {
  const { handleApply } = useApply();
  const rebuildStatus = useViewModel((s) => s.rebuildStatus);
  const rawLines = useViewModel((s) => s.rebuildLog.rawLines);
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const host = useViewModel((s) => s.preferences?.hostAttr ?? "this-mac");

  const [started, setStarted] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [dismissedCelebration, setDismissedCelebration] = useState(false);
  const [trackedOutcome, setTrackedOutcome] = useState<"success" | "error" | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const command = `darwin-rebuild switch --flake ${configDir || "."}#${host}`;

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

  // Fire the celebration once the build succeeds AND inference is configured.
  useEffect(() => {
    if (status === "success" && hasInference && !dismissedCelebration) {
      setCelebrate(true);
    }
  }, [status, hasInference, dismissedCelebration]);

  function runBuild() {
    setStarted(true);
    setTrackedOutcome(null);
    getTelemetry().captureEvent({ name: "first_build_started" });
    void handleApply();
  }

  return (
    <StepShell
      eyebrow={stepEyebrow("build")}
      title="Run your first build"
      description="This applies your flake to this Mac with darwin-rebuild. We'll stream the logs here and help you fix anything that fails before you finish."
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
          <Button onClick={runBuild} className="shrink-0">
            <Play className="size-4" aria-hidden="true" />
            Run build
          </Button>
        ) : status === "running" ? (
          <Button disabled className="shrink-0">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Building…
          </Button>
        ) : status === "error" ? (
          <Button onClick={runBuild} className="shrink-0">
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
                  "whitespace-pre-wrap break-words text-foreground/90",
                  /error|failed|fatal/i.test(line) && "text-destructive",
                )}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Help panel on failure */}
      {status === "error" ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <CircleAlert className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-sm">Build failed — let&apos;s fix it</p>
              <p className="text-muted-foreground text-xs">
                Your Mac was not changed. Try the most likely fixes, then retry.
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {FIXES.map((fix) => (
              <li
                key={fix.title}
                className="flex gap-3 rounded-lg border border-border bg-card p-3"
              >
                <Wrench
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-sm">{fix.title}</p>
                  <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
                    {fix.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
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
          <Button className="shrink-0" disabled={!hasInference} onClick={() => setCelebrate(true)}>
            Open nixmac
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {celebrate ? (
        <Suspense fallback={null}>
          <CelebrationOverlay
            host={host}
            onDismiss={() => {
              setCelebrate(false);
              setDismissedCelebration(true);
              onComplete();
            }}
          />
        </Suspense>
      ) : null}
    </StepShell>
  );
}
