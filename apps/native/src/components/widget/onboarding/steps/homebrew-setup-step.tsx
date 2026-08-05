"use client";

import { Button } from "@/components/ui/button";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { useHomebrewInstall } from "@/hooks/use-homebrew-install";
import { cn } from "@/lib/utils";
import { onboardingActions, useViewModel } from "@nixmac/state";
import { Beer, Check, CircleAlert, Loader2, SkipForward } from "lucide-react";
import { useEffect, useRef } from "react";

type HomebrewSetupState = "checking" | "missing" | "installing" | "failed" | "success";

export function HomebrewSetupStep() {
  const homebrewInstall = useViewModel((s) => s.homebrewInstall);
  const log = useViewModel((s) => s.homebrewLog);
  const { checkHomebrew, installHomebrew } = useHomebrewInstall();

  const homebrewInstalled = homebrewInstall?.installed ?? null;
  const errorMessage = homebrewInstall?.lastError ?? null;
  const logEndRef = useRef<HTMLDivElement>(null);

  // Derived, never stored: the phase cannot drift from the value the
  // onboarding gate reads, so "installed" and "not installed" can't be on
  // screen at the same time. An in-flight run wins over a stale probe result;
  // otherwise a recorded error means the last run failed.
  const phase: HomebrewSetupState = homebrewInstall?.installing
    ? "installing"
    : homebrewInstalled === true
      ? "success"
      : homebrewInstalled === null
        ? "checking"
        : errorMessage
          ? "failed"
          : "missing";

  // Auto-detect on mount when we haven't checked yet.
  useEffect(() => {
    if (homebrewInstalled === null) void checkHomebrew();
  }, [homebrewInstalled, checkHomebrew]);

  // Keep the streamed log scrolled to the latest line. Optional-chain the DOM
  // call so it is a no-op under jsdom (scrollIntoView is unimplemented there).
  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [log]);

  const handleInstall = () => {
    void installHomebrew();
  };

  const handleSkip = () => onboardingActions.setHomebrewSkipped(true);

  const skipButton = (
    <Button variant="ghost" onClick={handleSkip}>
      <SkipForward className="size-4" aria-hidden="true" />
      Skip for now
    </Button>
  );

  // Skip stays available while installing: the Command Line Tools wait can sit
  // on an Apple dialog for a long time, and force-quitting the app must not be
  // the only way out of this step.
  const footer =
    phase === "installing" ? (
      skipButton
    ) : phase === "missing" || phase === "failed" ? (
      <>
        {skipButton}
        <Button onClick={handleInstall}>
          <Beer className="size-4" aria-hidden="true" />
          {phase === "failed" ? "Try again" : "Install Homebrew"}
        </Button>
      </>
    ) : undefined;

  return (
    <StepShell
      eyebrow={stepEyebrow("homebrew-setup")}
      title="Homebrew"
      description="Homebrew is optional, but many app and package customizations rely on it. nixmac can install it for you with the official installer, or skip this and add it later — features that need Homebrew will be marked accordingly."
      footer={footer}
    >
      <div className="rounded-xl border border-border bg-card p-4">
        {phase === "checking" && (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking for Homebrew…
          </div>
        )}

        {(phase === "missing" || phase === "failed") && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  phase === "failed"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {phase === "failed" ? (
                  <CircleAlert className="size-4" />
                ) : (
                  <Beer className="size-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-sm">Homebrew was not found on this Mac</p>
                <p className="text-muted-foreground text-xs">
                  Install it with the official installer, or skip for now.
                </p>
              </div>
            </div>
            {phase === "failed" && errorMessage && (
              <p className="rounded-md bg-destructive/10 p-3 text-destructive text-xs leading-5">
                {errorMessage}
              </p>
            )}
          </div>
        )}

        {phase === "installing" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {homebrewInstall?.installPhase === "command-line-tools"
                ? "Waiting for the macOS Command Line Tools…"
                : "Installing Homebrew…"}
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-muted-foreground text-xs leading-5">
              {log.length === 0 ? (
                <span className="opacity-60">Starting installer…</span>
              ) : (
                log.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only log lines
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {phase === "success" && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-success">
            <Check className="size-5" aria-hidden="true" />
            Homebrew is installed
          </div>
        )}
      </div>
    </StepShell>
  );
}
