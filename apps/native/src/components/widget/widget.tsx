"use client";

import { EvolveOverlayPanel } from "@/components/evolve-overlay-panel";
import { RebuildOverlayPanel } from "@/components/rebuild-overlay-panel";
import { Console } from "@/components/widget/console";
import { ErrorMessage } from "@/components/widget/error-message";
import { FeedbackDialog } from "@/components/widget/feedback-dialog";
import { Header } from "@/components/widget/header";
import { ReportIssueButton } from "@/components/widget/report-issue-button";
import { SettingsDialog } from "@/components/widget/settings-dialog";
import { StepContentWrapper } from "@/components/widget/step-content-wrapper";
import { Stepper } from "@/components/widget/stepper";
import {
    EvolveStep,
    HistoryStep,
    MergeStep,
    NixSetupStep,
    PermissionsStep,
    SetupStep,
} from "@/components/widget/steps";
import { useErrorHandler } from "@/hooks/use-error-handler";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useNixInstall } from "@/hooks/use-nix-install";
import { usePanicHandler } from "@/hooks/use-panic-handler";
import { usePermissions } from "@/hooks/use-permissions";
import { usePrefs } from "@/hooks/use-prefs";
import { usePromptHistory } from "@/hooks/use-prompt-history";
import { useTrayEvents } from "@/hooks/use-tray-events";
import { useWatcher } from "@/hooks/use-watcher";
import { loadConfig, loadHosts } from "@/hooks/use-widget-initialization";
import { useSummary } from "@/hooks/use-summary";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { setupErrorTestHelpers } from "@/utils/error-test-helpers";
import { useEffect } from "react";

/**
 * Main widget component that connects to Tauri backend.
 * State is computed entirely on the client - the server just exposes.
 */
export function DarwinWidget() {
  const step = useCurrentStep();
  const { getInitialStatus } = useGitOperations();
  const { checkNix } = useNixInstall();
  const { checkPermissions } = usePermissions();
  const { loadPrefs } = usePrefs();
  const { refreshPromptHistory } = usePromptHistory();
  const { startWatching } = useWatcher();
  const { findSummary } = useSummary();

  // Set up panic handler to catch Rust crashes and show feedback dialog
  usePanicHandler();

  // Listen for tray menu events (Send Feedback, Settings)
  useTrayEvents();

  // Set up error handler to catch unhandled JavaScript errors and promise rejections
  useErrorHandler();

  // Set up test helpers for error handlers (development only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      setupErrorTestHelpers();
    }
  }, []);

  // Load initial data once on mount, then start watching for changes
  useEffect(() => {
    (async () => {
      try {
        await checkPermissions();
        await loadConfig();
        await checkNix();
        await loadHosts();
        await getInitialStatus();
        await loadPrefs();
        await findSummary();
        refreshPromptHistory();
      } catch (e: unknown) {
        useWidgetStore.getState().setError((e as Error)?.message || String(e));
      }

      // Start watching for git changes after initial load
      startWatching();
    })();
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

      case "evolving":
        return <EvolveStep />;

      case "merge":
        return <MergeStep />;

      case "history":
        return <HistoryStep />;
    }
  };

  // Compute the visible error (if any, respecting suppression rules)
  const error = useWidgetStore((s) => s.error);
  const isErrorSuppressed =
    (step === "setup" && error?.includes("Failed to list hosts: path")) ||
    (step === "evolving" && error?.includes("cancelled by user"));
  const visibleError = error && !isErrorSuppressed ? error : undefined;

  return (
    <div className="flex h-full w-full flex-col bg-background/90 backdrop-blur-xl">
      <Header />
      <Stepper />

      <StepContentWrapper>
        <ErrorMessage />
        {getActiveStepComponent()}
        <EvolveOverlayPanel />
        <RebuildOverlayPanel />
        <ReportIssueButton />
      </StepContentWrapper>

      <Console />
      <SettingsDialog />
      <FeedbackDialog mainWindowError={visibleError} />
    </div>
  );
}
