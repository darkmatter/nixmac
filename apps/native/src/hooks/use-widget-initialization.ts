import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
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
  updatePreviewIndicator: ReturnType<typeof usePreviewIndicator>["updatePreviewIndicator"]
) {
  const currentStore = useWidgetStore.getState();

  // Update preview indicator with initial state
  await updatePreviewIndicator({
    gitStatus,
    summaryText: null,
    isLoading: true,
  });

  // Fetch summary if there are uncommitted changes
  if (!gitStatus?.hasChanges) {
    await updatePreviewIndicator({
      gitStatus,
      summaryText: null,
      isLoading: false,
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
      additions: currentStore.summary.additions,
      deletions: currentStore.summary.deletions,
    });
    return;
  }

  currentStore.setSummary({ isLoading: true });
  try {
    const response = await darwinAPI.summarize.changes();
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
      additions: response.additions,
      deletions: response.deletions,
    });
  } catch {
    currentStore.setSummary({ isLoading: false });
    await updatePreviewIndicator({
      gitStatus,
      summaryText: null,
      isLoading: false,
    });
  }
}
