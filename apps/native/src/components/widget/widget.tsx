"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appStateToStep,
  computeAppState,
  useWidgetStore,
} from "@/stores/widget-store";
import {
  CONFIG_CHANGED_CHANNEL,
  type ConfigChangedEvent,
  darwinAPI,
  EVOLVE_EVENT_CHANNEL,
  type EvolveEvent,
  ipcRenderer,
} from "@/tauri-api";
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

  const handlePickDir = useCallback(async () => {
    const dir = (await darwinAPI.config.pickDir()) as string | null;
    if (dir) {
      storeRef.current.setConfigDir(dir);
      try {
        const hosts = (await darwinAPI.flake.listHosts()) as string[];
        if (Array.isArray(hosts)) {
          storeRef.current.setHosts(hosts);
        }
      } catch {
        // Ignore - hosts will remain empty
      }
      try {
        const status = await darwinAPI.git.status();
        storeRef.current.setGitStatus(status);
      } catch {
        // Ignore - git status will remain null
      }
    }
  }, []);

  const handleSaveHost = useCallback(async (host: string) => {
    storeRef.current.setHost(host);
    await darwinAPI.config.setHostAttr(host);
  }, []);

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
    const unlistenEvolve = await ipcRenderer.on<EvolveEvent>(
      EVOLVE_EVENT_CHANNEL,
      (event) => {
        if (event.payload) {
          storeRef.current.appendEvolveEvent(event.payload);
          // Also append raw log to console for debugging
          if (event.payload.raw) {
            storeRef.current.appendLog(`${event.payload.raw}\n`);
          }
        }
      },
    );

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

  const handleApply = useCallback(async () => {
    const s = storeRef.current;
    s.setProcessing(true, "apply");
    s.clearLogs();
    s.setConsoleExpanded(true);
    s.appendLog("> Running darwin-rebuild switch...\n");

    const unlistenData = await ipcRenderer.on(
      "darwin:apply:data",
      (event: { payload?: { chunk?: string } }) => {
        storeRef.current.appendLog(event.payload?.chunk || "");
      },
    );

    const unlistenEnd = await ipcRenderer.on("darwin:apply:end", async () => {
      const currentStore = storeRef.current;
      currentStore.setProcessing(false);
      unlistenData();
      unlistenEnd();
      currentStore.appendLog("\n✓ Apply complete\n");
      await refreshGitStatus();
    });

    try {
      await darwinAPI.darwin.applyStreamStart();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      s.setError(msg);
      s.appendLog(`\n✗ Error: ${msg}\n`);
      s.setProcessing(false);
      unlistenData();
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
        const summaryText = currentStore.summary.items
          .map((i) => i.title)
          .join(", ");
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
          storeRef.current.setError((e as Error)?.message || String(e));
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

    const configSub = ipcRenderer.on<ConfigChangedEvent>(
      CONFIG_CHANGED_CHANNEL,
      (_event) => {
        // Debounce refreshes so rapid filesystem events don't spam git.
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          refreshGitStatus();
        }, 300);
      },
    );

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

    // Only fetch when transitioning INTO preview mode
    if (
      appState === "preview" &&
      wasNotPreview &&
      store.summary.items.length === 0
    ) {
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
      store.summary.items.length > 0
        ? store.summary.items.map((i) => i.title).join(", ")
        : null;
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
      configDir={store.configDir}
      consoleExpanded={store.consoleExpanded}
      consoleLogs={store.consoleLogs}
      error={store.error}
      evolveEvents={store.evolveEvents}
      evolvePrompt={store.evolvePrompt}
      gitStatus={store.gitStatus}
      host={store.host}
      hosts={store.hosts}
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
      onHostsChange={store.setHosts}
      onPickDir={handlePickDir}
      onSaveHost={handleSaveHost}
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
