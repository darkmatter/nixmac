"use client";

import { Button } from "@/components/ui/button";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { useHomebrewInstall } from "@/hooks/use-homebrew-install";
import { cn } from "@/lib/utils";
import { onboardingActions, useOnboarding } from "@nixmac/state";
import { Beer, Check, CircleAlert, Loader2, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type HomebrewSetupState = "checking" | "missing" | "installing" | "failed" | "success";

export function HomebrewSetupStep() {
  const homebrewInstalled = useOnboarding((s) => s.homebrewInstalled);
  const { checkHomebrew, installHomebrew } = useHomebrewInstall();

  const [phase, setPhase] = useState<HomebrewSetupState>(
    homebrewInstalled === true ? "success" : homebrewInstalled === null ? "checking" : "missing",
  );
  const [log, setLog] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-detect on mount when we haven't checked yet.
  useEffect(() => {
    if (homebrewInstalled === null) void checkHomebrew();
  }, [homebrewInstalled, checkHomebrew]);

  // Reflect store changes (e.g. a detection that found brew) into local phase,
  // but don't clobber an in-progress install.
  useEffect(() => {
    if (phase === "installing") return;
    if (homebrewInstalled === true) setPhase("success");
    else if (homebrewInstalled === false && phase === "checking") setPhase("missing");
  }, [homebrewInstalled, phase]);

  // Keep the streamed log scrolled to the latest line. Optional-chain the DOM
  // call so it is a no-op under jsdom (scrollIntoView is unimplemented there).
  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [log]);

  const handleInstall = () => {
    setLog([]);
    setErrorMessage(null);
    setPhase("installing");
    void installHomebrew({
      onLine: (line) => setLog((prev) => [...prev, line]),
      onDone: (ok, error) => {
        if (ok) {
          setPhase("success");
        } else {
          setErrorMessage(error ?? "Homebrew installation failed.");
          setPhase("failed");
        }
      },
    });
  };

  const handleSkip = () => onboardingActions.setHomebrewSkipped(true);

  const footer =
    phase === "missing" || phase === "failed" ? (
      <>
        <Button variant="ghost" onClick={handleSkip}>
          <SkipForward className="size-4" aria-hidden="true" />
          Skip for now
        </Button>
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
              Installing Homebrew…
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
