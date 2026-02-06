"use client";

import { RebuildOverlayPanel } from "@/components/rebuild-overlay-panel";
import { Console } from "@/components/widget/console";
import { ErrorMessage } from "@/components/widget/error-message";
import { Header } from "@/components/widget/header";
import { SettingsDialog } from "@/components/widget/settings-dialog";
import { Stepper } from "@/components/widget/stepper";
import {
  CommitStep,
  EvolvingStep,
  OverviewStep,
  PermissionsStep,
  SetupStep,
} from "@/components/widget/steps";
import { useGitOperations } from "@/hooks/use-git-operations";
import { usePermissions } from "@/hooks/use-permissions";
import { usePreviewIndicator } from "@/hooks/use-preview-indicator";
import { useWatcher } from "@/hooks/use-watcher";
import {
  loadConfig,
  loadHosts,
  recoverFromGitState,
} from "@/hooks/use-widget-initialization";
import { cn } from "@/lib/utils";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { useEffect } from "react";

/**
 * Main widget component that connects to Tauri backend.
 *
 * State is computed entirely on the client - the server just exposes
 * data endpoints (config, git status, etc.) without tracking UI state.
 */

export function DarwinWidget() {
  const step = useCurrentStep();
  const { refreshGitStatus } = useGitOperations();
  const { checkPermissions } = usePermissions();
  const { updatePreviewIndicator } = usePreviewIndicator();
  const { startWatching } = useWatcher();

  // =============================================================================
  // Global Widget Effects
  // =============================================================================

  // Load initial data once on mount, then start watching for changes
  useEffect(() => {

    (async () => {
      try {
        await checkPermissions();
        await loadConfig();
        await loadHosts();
        const gitStatus = await refreshGitStatus();
        await recoverFromGitState(gitStatus, updatePreviewIndicator);
      } catch (e: unknown) {
        useWidgetStore.getState().setError((e as Error)?.message || String(e));
      }

      // After initial load
      startWatching();
    })();
  }, []);

  // =============================================================================
  // Routing mechanism
  // =============================================================================

  const getActiveStepComponent = () => {
    switch (step) {
      case "permissions":
        return <PermissionsStep />;

      case "setup":
        return <SetupStep />;

      case "overview":
        return <OverviewStep />;

      case "commit":
        return <CommitStep />;

      case "evolving":
        return <EvolvingStep />;

      default:
        return <OverviewStep />;
    }
  };

  // =============================================================================
  // Render
  // =============================================================================

  return (
      <div className="flex h-full w-full flex-col bg-background/90 backdrop-blur-xl">
        <Header />
        <Stepper />

        {/* Main Content */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-auto">
          <div className={cn("flex-1 p-5", step !== "evolving" && "overflow-auto")}>
            <ErrorMessage />
            {getActiveStepComponent()}
          </div>
          <RebuildOverlayPanel />
        </div>

        <Console />
        <SettingsDialog />
      </div>
  );
}
