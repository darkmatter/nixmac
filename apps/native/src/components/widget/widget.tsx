"use client";

import { useWidgetStore } from "@/stores/widget-store";
import { computeAppState, appStateToStep } from "@/components/widget/utils";
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

/**
 * Main widget component that connects to Tauri backend.
 * This handles all API calls and state synchronization.
 *
 * State is computed entirely on the client - the server just exposes
 * data endpoints (config, git status, etc.) without tracking UI state.
 *
 * For UI-only testing, use WidgetUI directly with mocked props.
 */

export function DarwinWidget() {
  const store = useWidgetStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const intervalRef = useRef<number | null>(null);
  const [_updatedAt, setUpdatedAt] = useState(Date.now());
  const appState = computeAppState(store);
  const step = appStateToStep(appState, store.gitStatus);
  const { refreshGitStatus } = useGitOperations();
  const { updatePreviewIndicator } = usePreviewIndicator();

  // =============================================================================
  // Effects
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
          // Only set error for actual failures, not missing flake
          console.log("step when mounted", step, errorMessage);
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
  }, [refreshGitStatus, updatePreviewIndicator]);

  // Listen for config file changes from the backend watcher
  // This auto-refreshes git status when files are modified externally
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const configSub = ipcRenderer.on<ConfigChangedEvent>(CONFIG_CHANGED_CHANNEL, (_event) => {
      // Debounce refreshes so rapid filesystem events don't spam git.
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        refreshGitStatus();
      }, 300);
    });

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      configSub.then((unlisten) => unlisten());
    };
  }, [refreshGitStatus]);

  // Fetch summary when entering preview mode
  // Use refs to avoid stale closures and dependency issues
  const prevAppStateRef = useRef(appState);
  useEffect(() => {
    const wasNotPreview = prevAppStateRef.current !== "preview";
    prevAppStateRef.current = appState;

    // Consider the summary empty/stale if no items or we have modified files
    // in the git status(simple heuristic).
    const summaryEmpty = store.summary.items.length === 0;

    const summaryStale =
      !summaryEmpty &&
      store.gitStatus &&
      Array.isArray(store.gitStatus.modified) &&
      store.gitStatus.modified.length > 0;

    const shouldFetch =
      (appState === "preview" && wasNotPreview && summaryEmpty) ||
      (store.gitStatus?.hasChanges && (summaryEmpty || summaryStale));

    // Only fetch when transitioning INTO preview mode
    if (shouldFetch) {
      (async () => {
        storeRef.current.setSummary({ isLoading: true });
        try {
          const response = await darwinAPI.summarize.changes();
          storeRef.current.setSummary({
            items: response.items,
            instructions: response.instructions,
            commitMessage: response.commitMessage,
            filesChanged: response.filesChanged,
            additions: response.additions,
            deletions: response.deletions,
            diff: response.diff,
            isLoading: false,
          });
        } catch {
          storeRef.current.setSummary({ isLoading: false });
        }
      })();
    }
  }, [appState, store.summary.items.length]);

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

  // Update commit message from AI suggestion
  useEffect(() => {
    if (store.summary.commitMessage && !store.commitMsg) {
      storeRef.current.setCommitMsg(store.summary.commitMessage);
    }
  }, [store.summary.commitMessage, store.commitMsg]);

  // Poll git status when dirty to detect index-only changes (e.g. `git add`).
  // Uses exponential backoff if the status is stable, up to 1 minute.
  useEffect(() => {
    if (intervalRef.current) {
      return; // Already polling
    }

    let interval = 1000;
    const pollGitStatus = async () => {
      const currFindeprint = JSON.stringify(storeRef.current.gitStatus);
      try {
        const status = await darwinAPI.git.status();
        storeRef.current.setGitStatus(status);
        const newFingerprint = JSON.stringify(status);
        if (currFindeprint === newFingerprint) {
          // No changes detected - increase interval
          interval = Math.min(interval * 1.5, 60_000); // Cap at 1 minute
        } else {
          // Changes detected - reset interval
          interval = 1000;
          storeRef.current.setGitStatus(status);
          setUpdatedAt(Date.now()); // Trigger re-render
        }
      } catch {
        // Ignore errors
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
  // TEMPORARY Routing Logic TODO:ADD ROUTER
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
  // TEMPORARY Render TODO:ADD ROUTER
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
