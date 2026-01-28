"use client";

import { appStateToStep, computeAppState, useWidgetStore } from "@/stores/widget-store";
import {
  CONFIG_CHANGED_CHANNEL,
  type ConfigChangedEvent,
  darwinAPI,
  EVOLVE_EVENT_CHANNEL,
  type EvolveEvent,
  ipcRenderer,
} from "@/tauri-api";
import { useCallback, useEffect, useRef, useState } from "react";
import { WidgetUI } from "./widget-ui";

// =============================================================================
// Types
// =============================================================================

interface Config {
  configDir: string;
  hostAttr?: string;
}

// =============================================================================
// Connected Widget Component
// =============================================================================

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
  // Use a ref to access latest store state in callbacks without causing re-subscriptions
  const storeRef = useRef(store);
  storeRef.current = store;
  const intervalRef = useRef<number | null>(null);
  const [_updatedAt, setUpdatedAt] = useState(Date.now()); // Used to trigger re-renders

  // Preferences state
  const [prefFloatingFooter, setPrefFloatingFooter] = useState(false);
  const [prefWindowShadow, setPrefWindowShadow] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");

  // Compute app state from current store state
  const appState = computeAppState(store);
  const step = appStateToStep(appState, store.showCommitScreen);

  // =============================================================================
  // API Handlers
  // =============================================================================

  const refreshGitStatus = useCallback(async () => {
    try {
      const status = await darwinAPI.git.status();
      storeRef.current.setGitStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);
  const gitStash = useCallback(async () => {
    try {
      await darwinAPI.git.stash("stashed changes from nixmac");
      const status = await refreshGitStatus();
      return status;
    } catch {
      return null;
    }
  }, [refreshGitStatus]);

  const handleEvolve = useCallback(async () => {
    const s = storeRef.current;
    if (!s.evolvePrompt.trim()) {
      return;
    }

    s.setProcessing(true, "evolve");
    s.setGenerating(true);
    s.setError(null);
    s.clearEvolveEvents(); // Clear previous events
    s.clearLogs();
    s.appendLog(`\n> Evolving: "${s.evolvePrompt}"\n`);

    // Set up evolve event listener
    const unlistenEvolve = await ipcRenderer.on<EvolveEvent>(EVOLVE_EVENT_CHANNEL, (event) => {
      if (event.payload) {
        storeRef.current.appendEvolveEvent(event.payload);
        // Also append raw log to console for debugging
        if (event.payload.raw) {
          storeRef.current.appendLog(`${event.payload.raw}\n`);
        }
      }
    });

    try {
      await darwinAPI.darwin.evolve(s.evolvePrompt);
      s.appendLog("✓ Evolution complete\n");
      await refreshGitStatus();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      s.setError(msg);
      s.appendLog(`✗ Error: ${msg}\n`);
    } finally {
      s.setProcessing(false);
      s.setGenerating(false);
      unlistenEvolve(); // Clean up listener
    }
  }, [refreshGitStatus]);

  // Ref to track line IDs for rebuild
  const rebuildLineIdRef = useRef(1);

  const handleApply = useCallback(async () => {
    const s = storeRef.current;
    s.setProcessing(true, "apply");
    s.startRebuild();
    rebuildLineIdRef.current = 1;

    // Listen to AI-summarized log events
    const unlistenSummary = await ipcRenderer.on<{
      text: string;
      complete?: boolean;
      success?: boolean;
      error?: boolean;
      error_type?: "infinite_recursion" | "evaluation_error" | "build_error" | "generic_error";
    }>("darwin:apply:summary", (event) => {
      const { text, complete, success, error, error_type } = event.payload;
      const currentStore = storeRef.current;

      if (complete) {
        currentStore.appendRebuildLine({
          id: rebuildLineIdRef.current++,
          text,
          type: success ? "info" : "stderr",
        });
        currentStore.setRebuildComplete(success ?? false);
      } else if (error) {
        currentStore.setRebuildError(error_type ?? "generic_error", text);
        currentStore.appendRebuildLine({
          id: rebuildLineIdRef.current++,
          text,
          type: "stderr",
        });
      } else {
        currentStore.appendRebuildLine({
          id: rebuildLineIdRef.current++,
          text,
          type: "info",
        });
      }
    });

    // Listen for rebuild end event
    const unlistenEnd = await ipcRenderer.on<{ ok: boolean; code: number }>(
      "darwin:apply:end",
      async (event) => {
        const currentStore = storeRef.current;
        currentStore.setProcessing(false);
        currentStore.setRebuildComplete(event.payload.ok, event.payload.code);
        unlistenSummary();
        unlistenEnd();

        // If successful, stage all changes and auto-dismiss overlay
        if (event.payload.ok) {
          try {
            await darwinAPI.git.stageAll();
          } catch (e) {
            console.error("Failed to stage changes:", e);
          }
          // Auto-dismiss overlay after success (short delay for user feedback)
          setTimeout(() => {
            storeRef.current.clearRebuild();
          }, 1500);
        }
        // On failure, keep the overlay visible so user can see error and rollback

        await refreshGitStatus();
      },
    );

    try {
      await darwinAPI.darwin.applyStreamStart();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      s.setRebuildError("generic_error", msg);
      s.setRebuildComplete(false);
      s.setProcessing(false);
      unlistenSummary();
      unlistenEnd();
    }
  }, [refreshGitStatus]);

  const handleCommit = useCallback(async () => {
    const s = storeRef.current;
    if (!s.commitMsg.trim()) {
      return;
    }

    s.setProcessing(true, "commit");
    s.appendLog(`\n> Committing: "${s.commitMsg}"\n`);

    try {
      await darwinAPI.git.commit(s.commitMsg);
      s.appendLog("✓ Committed successfully\n");
      s.setCommitMsg("");
      s.setEvolvePrompt("");
      s.clearPreview(); // Clear preview state (client-side)
      await refreshGitStatus();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      s.setError(msg);
      s.appendLog(`✗ Error: ${msg}\n`);
    } finally {
      s.setProcessing(false);
    }
  }, [refreshGitStatus]);

  const handleCancel = useCallback(async () => {
    const s = storeRef.current;
    s.setProcessing(true, "cancel");
    s.appendLog("\n> Stashing changes...\n");

    try {
      await gitStash();
      s.appendLog("✓ Changes stashed\n");
      s.setEvolvePrompt("");
      s.clearPreview(); // Clear preview state (client-side)
      await refreshGitStatus();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      s.setError(msg);
      s.appendLog(`✗ Error: ${msg}\n`);
    } finally {
      s.setProcessing(false);
    }
  }, [refreshGitStatus, gitStash]);

  // =============================================================================
  // Initialization Helpers
  // =============================================================================

  const loadConfig = useCallback(async () => {
    const cfg = (await darwinAPI.config.get()) as Config | null;
    if (cfg?.configDir) {
      storeRef.current.setConfigDir(cfg.configDir);
    }
    if (cfg?.hostAttr) {
      storeRef.current.setHost(cfg.hostAttr);
    }
  }, []);

  const loadHosts = useCallback(async () => {
    const hosts = (await darwinAPI.flake.listHosts()) as string[];
    if (Array.isArray(hosts)) {
      storeRef.current.setHosts(hosts);
    }
  }, []);

  // Update preview indicator window
  const updatePreviewIndicator = useCallback(
    async (params: {
      gitStatus: Awaited<ReturnType<typeof darwinAPI.git.status>> | null;
      summaryText: string | null;
      isLoading: boolean;
      isExpanded: boolean;
      additions?: number;
      deletions?: number;
    }) => {
      const hasChanges = params.gitStatus?.hasChanges ?? false;
      const filesChanged = params.gitStatus?.files?.length ?? 0;

      // Show preview indicator when there are uncommitted changes and main window is NOT expanded
      const shouldShow = hasChanges && !params.isExpanded;

      await darwinAPI.previewIndicator
        .update({
          visible: shouldShow,
          summary: params.summaryText,
          filesChanged,
          additions: params.additions,
          deletions: params.deletions,
          isLoading: params.isLoading,
        })
        .catch(() => {
          // Ignore errors - window might not exist yet
        });
    },
    [],
  );

  // Auto-recover state from git status on startup
  // If there are staged changes, restore preview state
  // If there are any uncommitted changes, fetch a summary
  const recoverFromGitState = useCallback(
    async (
      gitStatus: Awaited<ReturnType<typeof darwinAPI.git.status>> | null,
      mounted: { current: boolean },
    ) => {
      const currentStore = storeRef.current;

      // Update preview indicator with initial state
      await updatePreviewIndicator({
        gitStatus,
        summaryText: null,
        isLoading: true,
        isExpanded: currentStore.isExpanded,
      });

      // Fetch summary if there are uncommitted changes
      if (!gitStatus?.hasChanges) {
        // No changes - hide preview indicator
        await updatePreviewIndicator({
          gitStatus,
          summaryText: null,
          isLoading: false,
          isExpanded: currentStore.isExpanded,
        });
        return;
      }

      if (currentStore.summary.items.length > 0) {
        // Already have summary - use first item's title for preview indicator
        const summaryText = currentStore.summary.items.map((i) => i.title).join(", ");
        await updatePreviewIndicator({
          gitStatus,
          summaryText,
          isLoading: false,
          isExpanded: currentStore.isExpanded,
          additions: currentStore.summary.additions,
          deletions: currentStore.summary.deletions,
        });
        return;
      }

      currentStore.setSummary({ isLoading: true });
      try {
        const response = await darwinAPI.summarize.changes();
        if (mounted.current) {
          currentStore.setSummary({
            items: response.items,
            instructions: response.instructions,
            commitMessage: response.commitMessage,
            filesChanged: response.filesChanged,
            additions: response.additions,
            deletions: response.deletions,
            diff: response.diff,
            isLoading: false,
          });
          // Update preview indicator with summary (use item titles for text)
          const summaryText = response.items.map((i) => i.title).join(", ");
          await updatePreviewIndicator({
            gitStatus,
            summaryText,
            isLoading: false,
            isExpanded: currentStore.isExpanded,
            additions: response.additions,
            deletions: response.deletions,
          });
        }
      } catch {
        if (mounted.current) {
          currentStore.setSummary({ isLoading: false });
          await updatePreviewIndicator({
            gitStatus,
            summaryText: null,
            isLoading: false,
            isExpanded: currentStore.isExpanded,
          });
        }
      }
    },
    [updatePreviewIndicator],
  );

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
        await recoverFromGitState(gitStatus, mounted);

        // Load preferences
        const prefs = await darwinAPI.ui.getPrefs();
        if (prefs && mounted.current) {
          setPrefFloatingFooter(prefs.floatingFooter ?? false);
          setPrefWindowShadow(prefs.windowShadow ?? false);
          setOpenaiApiKey(prefs.openaiApiKey ?? "");
        }
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
  }, [loadConfig, loadHosts, refreshGitStatus, recoverFromGitState]);

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
      isExpanded: store.isExpanded,
      additions: store.summary.additions,
      deletions: store.summary.deletions,
    });
  }, [
    store.gitStatus,
    store.summary.items,
    store.summary.isLoading,
    store.summary.additions,
    store.summary.deletions,
    store.isExpanded,
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
  // Render
  // =============================================================================

  return (
    <WidgetUI
      appState={appState}
      commitMsg={store.commitMsg}
      consoleExpanded={store.consoleExpanded}
      consoleLogs={store.consoleLogs}
      error={store.error}
      evolveEvents={store.evolveEvents}
      evolvePrompt={store.evolvePrompt}
      gitStatus={store.gitStatus}
      isGenerating={store.isGenerating}
      isProcessing={store.isProcessing}
      onApply={handleApply}
      onBackFromCommit={() => store.setShowCommitScreen(false)}
      onCancel={handleCancel}
      onCommit={handleCommit}
      onCommitMsgChange={store.setCommitMsg}
      onConsoleExpandedChange={store.setConsoleExpanded}
      onErrorDismiss={() => store.setError(null)}
      onEvolve={handleEvolve}
      onEvolvePromptChange={store.setEvolvePrompt}
      onSettingsOpenChange={store.setSettingsOpen}
      onShowCommitScreen={() => store.setShowCommitScreen(true)}
      openaiApiKey={openaiApiKey}
      prefFloatingFooter={prefFloatingFooter}
      prefWindowShadow={prefWindowShadow}
      processingAction={store.processingAction}
      setOpenaiApiKey={setOpenaiApiKey}
      setPrefFloatingFooter={setPrefFloatingFooter}
      setPrefWindowShadow={setPrefWindowShadow}
      settingsOpen={store.settingsOpen}
      step={step}
      summary={store.summary}
    />
  );
}
