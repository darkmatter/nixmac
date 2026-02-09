"use client";

import { EvolveOverlayPanel } from "@/components/evolve-overlay-panel";
import { RebuildOverlayPanel } from "@/components/rebuild-overlay-panel";
import { Console } from "@/components/widget/console";
import { ErrorMessage } from "@/components/widget/error-message";
import { Header } from "@/components/widget/header";
import { SettingsDialog } from "@/components/widget/settings-dialog";
import { Stepper } from "@/components/widget/stepper";
import {
  CommitStep,
  EvolveStep,
  PermissionsStep,
  SetupStep,
} from "@/components/widget/steps";
import { useGitOperations } from "@/hooks/use-git-operations";
import { usePermissions } from "@/hooks/use-permissions";
import { useSummary } from "@/hooks/use-summary";
import { useWatcher } from "@/hooks/use-watcher";
import { loadConfig, loadHosts } from "@/hooks/use-widget-initialization";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { useEffect } from "react";

/**
 * Main widget component that connects to Tauri backend.
 * State is computed entirely on the client - the server just exposes.
 */
export function DarwinWidget() {
  const step = useCurrentStep();
  const { refreshGitStatus } = useGitOperations();
  const { checkPermissions } = usePermissions();
  const { checkAndFetchSummary, loadCachedSummary } = useSummary();
  const { startWatching } = useWatcher();

  // Load initial data once on mount, then start watching for changes
  useEffect(() => {
    (async () => {
      try {
        await checkPermissions();
        await loadConfig();
        await loadHosts();
        await refreshGitStatus();
        await loadCachedSummary();
        await checkAndFetchSummary();
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

      case "setup":
        return <SetupStep />;

      case "evolving":
        return <EvolveStep />;

      case "commit":
        return <CommitStep />;
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-background/90 backdrop-blur-xl">
      <Header />
      <Stepper />

      <div className="relative flex min-h-0 flex-1 gap-4 flex-col overflow-auto p-4 xs:p-8 sm:px-12">
        <ErrorMessage />
        {getActiveStepComponent()}
        <EvolveOverlayPanel />
        <RebuildOverlayPanel />
      </div>

      <Console />
      <SettingsDialog />
    </div>
  );
}
