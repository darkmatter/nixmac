import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useEffect } from "react";
import { useGitOperations } from "./use-git-operations";
import { usePreviewIndicator } from "./use-preview-indicator";

export type Config = {
  configDir: string;
  hostAttr?: string;
}

/**
 * Loads config from backend and updates store.
 */
export async function loadConfig() {
  const cfg = (await darwinAPI.config.get()) as Config | null;
  if (cfg?.configDir) {
    useWidgetStore.getState().setConfigDir(cfg.configDir);
  }
  if (cfg?.hostAttr) {
    useWidgetStore.getState().setHost(cfg.hostAttr);
  }
}

/**
 * Loads available hosts from flake and updates store.
 */
export async function loadHosts() {
  const hosts = (await darwinAPI.flake.listHosts()) as string[];
  if (Array.isArray(hosts)) {
    useWidgetStore.getState().setHosts(hosts);
  }
}

/**
 * Recovers state from git status on startup.
 * If there are uncommitted changes, fetches a summary and updates preview indicator.
 */
export async function recoverFromGitState(
  gitStatus: Awaited<ReturnType<typeof darwinAPI.git.status>> | null,
  mounted: { current: boolean },
  updatePreviewIndicator: ReturnType<typeof usePreviewIndicator>["updatePreviewIndicator"]
) {
  const currentStore = useWidgetStore.getState();

  // Update preview indicator with initial state
  await updatePreviewIndicator({
    gitStatus,
    summaryText: null,
    isLoading: true,
    isExpanded: currentStore.isExpanded,
  });

  // Fetch summary if there are uncommitted changes
  if (!gitStatus?.hasChanges) {
    await updatePreviewIndicator({
      gitStatus,
      summaryText: null,
      isLoading: false,
      isExpanded: currentStore.isExpanded,
    });
    return;
  }

  if (currentStore.summary.items.length > 0) {
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
        diff: response.diff,
        isLoading: false,
      });
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
}

/**
 * Hook for widget initialization on startup.
 * Loads config, hosts, git status, and recovers preview state if changes exist.
 */
export function useWidgetInitialization(
  step: string,
  setPrefFloatingFooter: (val: boolean) => void,
  setPrefWindowShadow: (val: boolean) => void,
  setOpenaiApiKey: (val: string) => void
) {
  const { refreshGitStatus } = useGitOperations();
  const { updatePreviewIndicator } = usePreviewIndicator();

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
        const prefs = await darwinAPI.ui.getPrefs();
        if (prefs && mounted.current) {
          setPrefFloatingFooter(prefs.floatingFooter ?? false);
          setPrefWindowShadow(prefs.windowShadow ?? false);
          setOpenaiApiKey(prefs.openaiApiKey ?? "");
        }
      } catch (e: unknown) {
        if (mounted.current) {
          const errorMessage = (e as Error)?.message || String(e);
          const supressFlakeError =
            step === "setup" &&
            errorMessage.includes("Failed to list hosts: path");
          if (!supressFlakeError) {
            useWidgetStore.getState().setError(errorMessage);
          }
        }
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, [
    refreshGitStatus,
    updatePreviewIndicator,
    step,
    setPrefFloatingFooter,
    setPrefWindowShadow,
    setOpenaiApiKey,
  ]);
}
