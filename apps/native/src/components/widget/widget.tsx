"use client";

import { ConfigEditOverlayPanel } from "@/components/widget/overlays/config-edit-overlay-panel";
import { EditorPanel } from "@/components/widget/overlays/editor-panel";
import { EvolveOverlayPanel } from "@/components/widget/overlays/evolve-overlay-panel";
import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import { Console } from "@/components/widget/layout/console";
import { ErrorMessage } from "@/components/widget/layout/error-message";
import { FeedbackDialog } from "@/components/widget/feedback/feedback-dialog";
import { Header } from "@/components/widget/layout/header";
import { ReportIssueButton } from "@/components/widget/feedback/report-issue-button";
import { SettingsDialog } from "@/components/widget/settings/settings-dialog";
import { StepContentWrapper } from "@/components/widget/layout/step-content-wrapper";
import { Stepper } from "@/components/widget/layout/stepper";
import { OnboardingFlow } from "@/components/widget/onboarding/onboarding-flow";
import { useOnboarding } from "@nixmac/state";
import {
  BeginStep,
  CommitStep,
  EvolveStep,
  FilesystemStep,
  HistoryStep,
  ManualCommitStep,
  ManualEvolveStep,
} from "@/components/widget/steps";
import { surfaceRecoveryReport } from "@/hooks/use-feedback-on-recovery";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useNixInstall } from "@/hooks/use-nix-install";
import { usePanicHandler } from "@/hooks/use-panic-handler";
import { usePermissions } from "@/hooks/use-permissions";
import { useTrayEvents } from "@/hooks/use-tray-events";
import { markBootRenderStage, markBootStage } from "@/lib/boot-diagnostics";
import { useEvolveMascot } from "@/hooks/use-evolve-mascot";
import { useUiState } from "@nixmac/state";
import { useCurrentStep } from "@/hooks/use-current-step";
import { UpdateBanner } from "@/components/widget/layout/update-banner";
import { startViewModelSync } from "@/viewmodel";
import { setupErrorTestHelpers } from "@/utils/error-test-helpers";
import { setupWidgetTestHelpers } from "@/utils/widget-test-helpers";
import { useEffect } from "react";

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

  // Esc closes the settings modal or history panel (settings takes priority since it overlays history).
  // Respects defaultPrevented so nested Radix layers (Select/Popover/inner dialogs) handle Esc first.
  // Skips during IME composition — Esc cancels the candidate, not the modal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const {
        settingsOpen,
        showHistory,
        showFilesystem,
        isProcessing,
        isGenerating,
        setSettingsOpen,
        setShowHistory,
        setShowFilesystem,
      } = useUiState.getState();
      if (settingsOpen) {
        e.preventDefault();
        setSettingsOpen(false);
      } else if (showHistory && !(isProcessing || isGenerating)) {
        e.preventDefault();
        setShowHistory(false);
      } else if (showFilesystem && !(isProcessing || isGenerating)) {
        e.preventDefault();
        setShowFilesystem(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        useUiState.getState().setError((e as Error)?.message || String(e));
      }

      if (cancelled) return;
      surfaceRecoveryReport();
    })();

    return () => {
      cancelled = true;
      stopViewModelSync?.();
    };
  }, []);

  // Onboarding (permissions → nix → flake import → customizations → inference →
  // first build) takes over the whole window via OnboardingFlow. The first
  // three gates come from the live backend; the post-setup steps are tracked
  // by the onboarding store, which keeps the flow on screen until completed.
  const onboardingActivePost = useOnboarding((s) => s.active);
  const onboardingCompleted = useOnboarding((s) => s.completed);
  const isOnboardingGate = step === "permissions" || step === "nix-setup" || step === "setup";
  const showOnboarding = !onboardingCompleted && (isOnboardingGate || onboardingActivePost);

  // Routing mechanism
  const getActiveStepComponent = () => {
    switch (step) {
      case "begin":
        return <BeginStep />;

      case "evolve":
        return <EvolveStep />;

      case "commit":
        return <CommitStep />;

      case "manualEvolve":
        return <ManualEvolveStep />;

      case "manualCommit":
        return <ManualCommitStep />;

      case "history":
        return <HistoryStep />;

      case "filesystem":
        return <FilesystemStep />;
    }
  };

  // Filesystem renders edge-to-edge with its own internal scrollers, so it skips
  // the StepContentWrapper's padding & overflow handling.
  const isEdgeToEdgeStep = step === "filesystem";

  if (showOnboarding) {
    return (
      <div className="flex min-h-[600px] min-w-[800px] h-full w-full flex-col bg-background/90 backdrop-blur-xl">
        <OnboardingFlow />
        <SettingsDialog />
        <FeedbackDialog />
        <Console />
      </div>
    );
  }

  return (
    <div className="flex min-w-[800px] min-h-[600px]  h-full w-full flex-col bg-background/90 backdrop-blur-xl">
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

      <SettingsDialog />
      <FeedbackDialog />

      <Console />
    </div>
  );
}
