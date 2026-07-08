"use client";

import { ConfigEditOverlayPanel } from "@/components/widget/overlays/config-edit-overlay-panel";
import { EditorPanel } from "@/components/widget/overlays/editor-panel";
import { EtcClobberWarningDialog } from "@/components/widget/overlays/etc-clobber-warning-dialog";
import { EvolveOverlayPanel } from "@/components/widget/overlays/evolve-overlay-panel";
import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import { Console } from "@/components/widget/layout/console";
import { ErrorMessage } from "@/components/widget/layout/error-message";
import { FeedbackDialog } from "@/components/widget/feedback/feedback-dialog";
import { Header } from "@/components/widget/layout/header";
import { ReportIssueButton } from "@/components/widget/feedback/report-issue-button";
import { StepContentWrapper } from "@/components/widget/layout/step-content-wrapper";
import { Stepper } from "@/components/widget/layout/stepper";
import { OnboardingFlow } from "@/components/widget/onboarding/onboarding-flow";
import { useOnboardingFlow } from "@/components/widget/onboarding/use-onboarding-flow";
import { uiActions } from "@nixmac/state";
import {
  BeginStep,
  CommitStep,
  FilesystemStep,
  HistoryStep,
  ReviewStep,
} from "@/components/widget/steps";
import { surfaceRecoveryReport } from "@/hooks/use-feedback-on-recovery";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useNixInstall } from "@/hooks/use-nix-install";
import { usePanicHandler } from "@/hooks/use-panic-handler";
import { usePermissions } from "@/hooks/use-permissions";
import { useTrayEvents } from "@/hooks/use-tray-events";
import { markBootRenderStage, markBootStage } from "@/lib/boot-diagnostics";
import { useEvolveMascot } from "@/hooks/use-evolve-mascot";
import { useUiState, useViewModel } from "@nixmac/state";
import { useCurrentStep } from "@/hooks/use-current-step";
import { UpdateBanner } from "@/components/widget/layout/update-banner";
import { markViewModelHydrated, startViewModelSync } from "@/viewmodel";
import { setupErrorTestHelpers } from "@/utils/error-test-helpers";
import { setupWidgetTestHelpers } from "@/utils/widget-test-helpers";
import { useEffect } from "react";
import { nav, useIsOverlayActive } from "@/router";

/**
 * Main nixmac window / widget component.
 */

export function DarwinWidget() {
  markBootRenderStage("darwin-widget-render");

  const step = useCurrentStep();
  const { getInitialStatus } = useGitOperations();
  const { checkNix } = useNixInstall();
  const { checkPermissions } = usePermissions();

  // Experimental: spin the mascot in a corner indicator while evolving/building
  useEvolveMascot();

  // Set up panic handler to catch Rust crashes and show feedback dialog
  usePanicHandler();

  // Listen for tray menu events (Send Feedback, Settings)
  useTrayEvents();

  useEffect(() => {
    markBootStage("darwin-widget-committed");
  }, []);

  // Set up test helpers for error handlers and widget store (development only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      setupErrorTestHelpers();
      setupWidgetTestHelpers();
    }
  }, []);

  // Esc closes the topmost overlay. Settings is now a route (handled via the
  // router); history/filesystem are still store-driven pending migration.
  // Respects defaultPrevented so nested Radix layers (Select/Popover/inner
  // dialogs) handle Esc first. Skips during IME composition — Esc cancels the
  // candidate, not the modal.
  const isOverlayActive = useIsOverlayActive();
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      // Settings route takes priority (it overlays everything else).
      if (isOverlayActive) {
        e.preventDefault();
        nav.goHome();
        return;
      }
      const { showHistory, showFilesystem, isProcessing, isGenerating } =
        useUiState.getState();
      if (showHistory && !(isProcessing || isGenerating)) {
        e.preventDefault();
        uiActions.setShowHistory(false);
      } else if (showFilesystem && !(isProcessing || isGenerating)) {
        e.preventDefault();
        uiActions.setShowFilesystem(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOverlayActive]);

  // Load initial data once on mount, then start watching for changes
  useEffect(() => {
    let cancelled = false;
    let stopViewModelSync: (() => void) | null = null;

    (async () => {
      try {
        // Hydrate every mirrored slice (preferences/hosts, permissions,
        // prompt history, evolve, git, change map) before anything that
        // depends on config being available.
        const stop = await startViewModelSync();
        if (cancelled) {
          stop();
        } else {
          stopViewModelSync = stop;
        }

        // Explicit probes: permissions (writes the backend cell, which
        // round-trips through `permissions_changed`), Nix availability, and
        // the cached git status snapshot.
        await checkPermissions();
        await checkNix();
        await getInitialStatus();
      } catch (e: unknown) {
        uiActions.setError((e as Error)?.message || String(e));
      }

      // Mark hydration complete only after the explicit probes (nix check,
      // permissions, git status) have written their real values. The nix
      // install cell is NOT persisted — it defaults to null on every launch —
      // so flipping `hydrated` before checkNix runs would let the onboarding
      // gate see a stale null and flash OnboardingFlow for a frame.
      markViewModelHydrated();

      if (cancelled) return;
      surfaceRecoveryReport();
    })();

    return () => {
      cancelled = true;
      stopViewModelSync?.();
    };
  }, []);

  // Onboarding (permissions → nix → flake import → customizations → inference →
  // first build) takes over the whole window via OnboardingFlow. Whether to
  // show it is gated by the backend completion latch (mirrored as
  // `onboardingState`): the wizard appears on first launch and after an
  // explicit "Restart setup", never because a preference fact regressed
  // mid-session. In-flow step routing still derives from durable facts.
  const { showFlow: showOnboarding } = useOnboardingFlow();
  // Suppress the boot flash: before the ViewModel hydrates, every gate input
  // is a default (null preferences/nixInstall), so both OnboardingFlow and the
  // main widget would render against stale state for a frame. Hold a neutral
  // container until hydration completes, then render the correct path directly.
  const hydrated = useViewModel((s) => s.hydrated);

  // permissions/nix-setup/setup are owned by OnboardingFlow. Reaching one of
  // them while OnboardingFlow considers setup complete means the two gate
  // derivations (useOnboardingFlow vs useCurrentStep) disagree — a programming
  // error a user should never see. Surface it through the standard error
  // banner (with its Report Error flow) instead of letting the BeginStep
  // fallback below mask it. "setup" is excluded while a bootstrap is running:
  // computeCurrentStep legitimately returns it then, whatever the gates say.
  const isBootstrapping = useUiState((s) => s.isBootstrapping);
  useEffect(() => {
    const gateMismatch =
      step === "permissions" || step === "nix-setup" || (step === "setup" && !isBootstrapping);
    if (hydrated && !showOnboarding && gateMismatch) {
      uiActions.setError(
        `Internal error: onboarding step "${step}" was reached outside onboarding. This is a nixmac bug — please use "Report Error" to let us know.`,
      );
    }
  }, [step, hydrated, showOnboarding, isBootstrapping]);

  if (!hydrated) {
    return <div className="flex h-full w-full flex-col bg-background/60" />;
  }

  // Routing mechanism
  const getActiveStepComponent = () => {
    switch (step) {
      case "begin":
        return <BeginStep />;

      // The AI evolve step and the manual-drift step share one review surface.
      case "evolve":
      case "manualEvolve":
        return <ReviewStep />;

      case "commit":
        return <CommitStep />;

      case "manualCommit":
        return <CommitStep isManual />;

      case "history":
        return <HistoryStep />;

      case "filesystem":
        return <FilesystemStep />;

      // Defensive fallback: permissions/nix-setup/setup are owned by
      // OnboardingFlow, which takes over the window via showOnboarding when
      // those gates are unsatisfied. If a gate mismatch ever routes here
      // anyway, fall back to the prompt step instead of rendering nothing.
      default:
        return <BeginStep />;
    }
  };

  // Filesystem renders edge-to-edge with its own internal scrollers, so it skips
  // the StepContentWrapper's padding & overflow handling.
  const isEdgeToEdgeStep = step === "filesystem";

  if (showOnboarding) {
    return (
      <div className="flex min-h-[600px] min-w-[800px] h-full w-full flex-col bg-background/60">
        <OnboardingFlow />
        <EtcClobberWarningDialog />
        <FeedbackDialog />
        <Console />
      </div>
    );
  }

  return (
    <div className="flex min-w-[800px] min-h-[600px]  h-full w-full flex-col bg-background/60">
      <Header />
      <Stepper />
      <UpdateBanner />

      {isEdgeToEdgeStep ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ErrorMessage />
          {getActiveStepComponent()}
        </div>
      ) : (
        <StepContentWrapper>
          <ErrorMessage />
          {getActiveStepComponent()}
          <ReportIssueButton />
        </StepContentWrapper>
      )}

      <EvolveOverlayPanel />
      <ConfigEditOverlayPanel />
      <RebuildOverlayPanel />
      <EditorPanel />
      <EtcClobberWarningDialog />

      <FeedbackDialog />

      <Console />
    </div>
  );
}
