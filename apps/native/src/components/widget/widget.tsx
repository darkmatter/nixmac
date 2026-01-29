"use client";

import { useWidgetStore } from "@/stores/widget-store";
import { computeCurrentStep } from "@/components/widget/utils";
import {
  CONFIG_CHANGED_CHANNEL,
  type ConfigChangedEvent,
  darwinAPI,
  ipcRenderer,
} from "@/tauri-api";
import { loadConfig, loadHosts, recoverFromGitState } from "@/hooks/use-widget-initialization";
import { useEffect, useRef, useState } from "react";
import { SetupStep, OverviewStep, EvolvingStep, CommitStep } from "./steps";
import { Header } from "@/components/widget/header";
import { Stepper } from "@/components/widget/stepper";
import { Console } from "@/components/widget/console";
import { SettingsDialog } from "@/components/widget/settings-dialog";
import { ErrorMessage } from "@/components/widget/error-message";
import { RebuildOverlay } from "@/components/rebuild-overlay";
import { useGitOperations } from "@/hooks/use-git-operations";
import { usePreviewIndicator } from "@/hooks/use-preview-indicator";
import { cn } from "@/lib/utils";
import { useSummary } from "@/hooks/use-summary";

/**
 * Main widget component that connects to Tauri backend.
 *
 * State is computed entirely on the client - the server just exposes
 * data endpoints (config, git status, etc.) without tracking UI state.
 */

export function DarwinWidget() {
  const store = useWidgetStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const intervalRef = useRef<number | null>(null);
  const [_updatedAt, setUpdatedAt] = useState(Date.now());
  const step = computeCurrentStep(store);
  const { refreshGitStatus } = useGitOperations();
  const { updatePreviewIndicator } = usePreviewIndicator();
  const { checkAndFetchSummary } = useSummary();

  // =============================================================================
  // Global Widget Effects
  // =============================================================================

  // Load initial data once on mount
  useEffect(() => {
    const mounted = { current: true };

    (async () => {
      try {
        await loadConfig();
        await loadHosts();
        const gitStatus = await refreshGitStatus();
        await recoverFromGitState(gitStatus, mounted, updatePreviewIndicator);

        // Load preferences
      } catch (e: unknown) {
        if (mounted.current) {
          const errorMessage = (e as Error)?.message || String(e);
          const supressFlakeError =
            step === "setup" && errorMessage.includes("Failed to list hosts: path");
          if (!supressFlakeError) {
            storeRef.current.setError(errorMessage);
          }
        }
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, []);

  // Listen for config file changes from the backend watcher
  // This auto-refreshes git status when files are modified externally
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const configSub = ipcRenderer.on<ConfigChangedEvent>(CONFIG_CHANGED_CHANNEL, (_event) => {
      // Debounce refreshes so rapid filesystem events don't spam git.
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(async () => {
        await refreshGitStatus();
        checkAndFetchSummary();
      }, 300);
    });

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      configSub.then((unlisten) => unlisten());
    };
  }, [refreshGitStatus]);

  // Update preview indicator window when state changes
  useEffect(() => {
    const summaryText =
    store.summary.items.length > 0 ? store.summary.items.map((i) => i.title).join(", ") : null;
    updatePreviewIndicator({
      gitStatus: store.gitStatus,
      summaryText,
      isLoading: store.summary.isLoading,
      additions: store.summary.additions,
      deletions: store.summary.deletions,
    });
  }, [
    store.gitStatus,
    store.summary.items,
    store.summary.isLoading,
    store.summary.additions,
    store.summary.deletions,
    updatePreviewIndicator,
  ]);

  // Poll git status when dirty to detect index-only changes (e.g. `git add`).
  // Uses exponential backoff if the status is stable, up to 1 minute.
  useEffect(() => {
    if (intervalRef.current) {
      return; // Already polling
    }

    let interval = 1000;
    const pollGitStatus = async () => {
      const oldStatus = storeRef.current.gitStatus;
      const currFindeprint = JSON.stringify(oldStatus);

      try {
        const status = await darwinAPI.git.status();
        const newFingerprint = JSON.stringify(status);

        if (currFindeprint === newFingerprint) {
          // No changes detected - increase interval
          interval = Math.min(interval * 1.5, 60_000); // Cap at 1 minute
        } else {
          // Changes detected - reset interval
          interval = 1000;
          storeRef.current.setGitStatus(status);
          checkAndFetchSummary();
          setUpdatedAt(Date.now()); // Trigger re-render
        }
      } catch (error) {
      }

      intervalRef.current = window.setTimeout(pollGitStatus, interval);
    };

    pollGitStatus();

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // =============================================================================
  // Routing mechanism
  // =============================================================================

  const getActiveStepComponent = () => {
    switch (step) {
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
    <>
      <div className="flex h-full w-full flex-col bg-background/90 backdrop-blur-xl">
        <Header />
        <Stepper />

        {/* Main Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className={cn("flex-1 p-5", step !== "evolving" && "overflow-auto")}>
            <ErrorMessage />
            {getActiveStepComponent()}
          </div>
        </div>

        <Console />
        <SettingsDialog />
      </div>
      <RebuildOverlay />
    </>
  );
}
