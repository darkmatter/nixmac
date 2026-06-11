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
import {
    BeginStep,
    CommitStep,
    EvolveStep,
    FilesystemStep,
    HistoryStep,
    ManualCommitStep,
    ManualEvolveStep,
    NixSetupStep,
    PermissionsStep,
    SetupStep,
} from "@/components/widget/steps";
import { surfaceRecoveryReport } from "@/hooks/use-feedback-on-recovery";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useNixInstall } from "@/hooks/use-nix-install";
import { usePanicHandler } from "@/hooks/use-panic-handler";
import { usePermissions } from "@/hooks/use-permissions";
import { usePrefs } from "@/hooks/use-prefs";
import { usePromptHistory } from "@/hooks/use-prompt-history";
import { useTrayEvents } from "@/hooks/use-tray-events";
import { loadConfig, loadHosts, loadEvolveState } from "@/hooks/use-widget-initialization";
import { useSummary } from "@/hooks/use-summary";
import { markBootStage } from "@/lib/boot-diagnostics";
import { getTelemetry } from "@/lib/telemetry/instance";
import { useEvolveMascot } from "@/hooks/use-evolve-mascot";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { UpdateBanner } from "@/components/widget/layout/update-banner";
import { startViewModelSync } from "@/viewmodel";
import { setupErrorTestHelpers } from "@/utils/error-test-helpers";
import { setupWidgetTestHelpers } from "@/utils/widget-test-helpers";
import { useEffect, useState } from "react";

/**
 * Main nixmac window / widget component.
 */

let onboardingStartedTelemetryCaptured = false;

export function __resetOnboardingStartedTelemetryForTests() {
  onboardingStartedTelemetryCaptured = false;
}

function captureOnboardingStartedIfNeeded() {
  if (onboardingStartedTelemetryCaptured) return;

  const state = useWidgetStore.getState();
  const permissionsIncomplete =
    state.permissionsChecked &&
    state.permissionsState &&
    !state.permissionsState.allRequiredGranted;
  const nixReady =
    state.nixInstalled === true && state.darwinRebuildAvailable === true;
  // Count only first-run setup entry. A stale configured host after prior setup
  // can also land on the setup step, but it is a repair flow rather than activation.
  const setupRequired =
    state.isBootstrapping || !state.configDir || !state.host;

  if (permissionsIncomplete || !nixReady || !setupRequired) return;

  getTelemetry().captureEvent({
    name: "onboarding_started",
    props: { surface: "gui" },
  });
  onboardingStartedTelemetryCaptured = true;
}

export function DarwinWidget() {
  markBootStage("darwin-widget-render");

  const step = useCurrentStep();
  const [startupLoadComplete, setStartupLoadComplete] = useState(false);
  const configDir = useWidgetStore((state) => state.configDir);
  const host = useWidgetStore((state) => state.host);
  const isBootstrapping = useWidgetStore((state) => state.isBootstrapping);
  const nixInstalled = useWidgetStore((state) => state.nixInstalled);
  const darwinRebuildAvailable = useWidgetStore((state) => state.darwinRebuildAvailable);
  const permissionsChecked = useWidgetStore((state) => state.permissionsChecked);
  const permissionsState = useWidgetStore((state) => state.permissionsState);
  const { getInitialStatus } = useGitOperations();
  const { checkNix } = useNixInstall();
  const { checkPermissions } = usePermissions();
  const { loadPrefs } = usePrefs();
  const { refreshPromptHistory } = usePromptHistory();
  const { findChangeMap } = useSummary();

  // Experimental: spin the mascot in a corner indicator while evolving/building
  useEvolveMascot();

  // Set up panic handler to catch Rust crashes and show feedback dialog
  usePanicHandler();

  // Listen for tray menu events (Send Feedback, Settings)
  useTrayEvents();

  useEffect(() => {
    if (startupLoadComplete && step === "setup") {
      captureOnboardingStartedIfNeeded();
    }
  }, [
    configDir,
    darwinRebuildAvailable,
    host,
    isBootstrapping,
    nixInstalled,
    permissionsChecked,
    permissionsState,
    startupLoadComplete,
    step,
  ]);

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
      } = useWidgetStore.getState();
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
        await checkPermissions();
        await loadConfig();
        await checkNix();
        await loadHosts();
        await loadEvolveState();
        if (!cancelled) {
          setStartupLoadComplete(true);
        }
        await getInitialStatus();
        await loadPrefs();
        await findChangeMap();
        refreshPromptHistory();

        const stop = await startViewModelSync();
        if (cancelled) {
          stop();
        } else {
          stopViewModelSync = stop;
        }
      } catch (e: unknown) {
        useWidgetStore.getState().setError((e as Error)?.message || String(e));
      }

      if (cancelled) return;
      surfaceRecoveryReport();
    })();

    return () => {
      cancelled = true;
      stopViewModelSync?.();
    };
  }, []);

  // Routing mechanism
  const getActiveStepComponent = () => {
    switch (step) {
      case "permissions":
        return <PermissionsStep />;

      case "nix-setup":
        return <NixSetupStep />;

      case "setup":
        return <SetupStep />;

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

  return (
    <div className="flex h-full w-full flex-col bg-background/90 backdrop-blur-xl">
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
