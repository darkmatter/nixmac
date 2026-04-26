/**
 * Dev-only test helpers for driving the widget store from e2e tests.
 * Exposed on window.__testWidget so WDIO tests can call them via browser.execute.
 */

import { useWidgetStore } from "@/stores/widget-store";
import { computeCurrentStep } from "@/components/widget/utils";
import { darwinAPI } from "@/tauri-api";

export interface WidgetTestHelpers {
  /**
   * Set the evolve prompt input value directly via the store,
   * bypassing the React event system.
   * Usage: window.__testWidget.setEvolvePrompt("my prompt")
   */
  setEvolvePrompt: (value: string) => void;
  /**
   * True while an evolve action is actively processing.
   */
  isEvolveProcessing: () => boolean;
  /**
   * Current prompt history from the store.
   */
  getPromptHistory: () => string[];
  /**
   * Current computed widget step.
   */
  getCurrentStep: () => string;
  /**
   * Minimal store probe for behavior tests that need to wait on seeded state.
   */
  getStateProbe: () => {
    step: string;
    showHistory: boolean;
    gitFileCount: number;
    gitPaths: string[];
    historyCount: number;
  };
  /**
   * Seed a dirty git status so behavior tests can enter uncommitted-change states.
   */
  setDirtyGitStatus: (filePath?: string) => void;
  /**
   * Restore a clean git status after a dirty-state behavior test.
   */
  setCleanGitStatus: () => void;
  /**
   * Seed a small history list with a restore target while local changes exist.
   */
  seedDirtyRestoreHistory: () => void;
  /**
   * Seed confirmation preferences for scenarios that explicitly exercise dialogs.
   */
  setConfirmPrefs: (prefs: Partial<Record<"confirmBuild" | "confirmClear" | "confirmRollback", boolean>>) => void;
  /**
   * Seed the setup step with an existing nix-darwin repository and discovered hosts.
   */
  setSetupHosts: (configDir: string, hostAttr: string) => Promise<void>;
  /**
   * Keep the selected setup host in memory after the visible host-select click.
   */
  saveSetupHost: (hostAttr: string) => Promise<void>;
  /**
   * Capture the most relevant proof surface as a PNG data URL.
   */
  captureProofPng: (options?: ProofCaptureOptions) => Promise<string | null>;
}

export interface ProofCaptureOptions {
  includeAnnotations?: boolean;
  pixelRatio?: number;
}

function getProofTarget(): HTMLElement | null {
  const selectors = [
    '[data-testid="settings-dialog"]',
    '[data-testid="evolve-proof-region"]',
    '[data-testid="setup-step"]',
  ];

  for (const selector of selectors) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) {
      return node;
    }
  }

  return document.querySelector<HTMLElement>("#root");
}

function getProofCaptureTarget(options?: ProofCaptureOptions): HTMLElement | null {
  if (options?.includeAnnotations) {
    return document.body ?? getProofTarget();
  }

  return getProofTarget();
}

export function setupWidgetTestHelpers() {
  if (typeof window === "undefined") return;

  const helpers: WidgetTestHelpers = {
    setEvolvePrompt: (value: string) => {
      useWidgetStore.getState().setEvolvePrompt(value);
    },
    isEvolveProcessing: () => {
      const state = useWidgetStore.getState();
      return state.isProcessing && state.processingAction === "evolve";
    },
    getPromptHistory: () => {
      return [...(useWidgetStore.getState().promptHistory ?? [])];
    },
    getCurrentStep: () => {
      return computeCurrentStep(useWidgetStore.getState());
    },
    getStateProbe: () => {
      const state = useWidgetStore.getState();
      return {
        step: computeCurrentStep(state),
        showHistory: state.showHistory,
        gitFileCount: state.gitStatus?.files?.length ?? 0,
        gitPaths: state.gitStatus?.files?.map((file) => file.path) ?? [],
        historyCount: state.history.length,
      };
    },
    setDirtyGitStatus: (filePath = "modules/homebrew.nix") => {
      useWidgetStore.getState().setGitStatus({
        files: [{ path: filePath, changeType: "edited" }],
        branch: "main",
        diff: `diff --git a/${filePath} b/${filePath}\n`,
        additions: 1,
        deletions: 0,
        headCommitHash: "e2e-dirty-head",
        cleanHead: false,
        changes: [],
      });
    },
    setCleanGitStatus: () => {
      useWidgetStore.getState().setGitStatus({
        files: [],
        branch: "main",
        diff: "",
        additions: 0,
        deletions: 0,
        headCommitHash: "e2e-clean-head",
        cleanHead: true,
        changes: [],
      });
    },
    seedDirtyRestoreHistory: () => {
      const now = Math.floor(Date.now() / 1000);
      const restoreTarget = "e2e-restore-target";
      const currentHead = "e2e-current-head";
      const store = useWidgetStore.getState();
      store.setShowHistory(true);
      store.setHistory([
        {
          hash: currentHead,
          message: "current test head",
          createdAt: now,
          isBuilt: false,
          isBase: false,
          isExternal: false,
          isUndone: false,
          isOrphanedRestore: false,
          fileCount: 1,
          commit: null,
          changeMap: null,
          unsummarizedHashes: [],
          rawChanges: [],
          originMessage: null,
          originHash: null,
        },
        {
          hash: restoreTarget,
          message: "restore target from yesterday",
          createdAt: now - 86400,
          isBuilt: false,
          isBase: false,
          isExternal: false,
          isUndone: false,
          isOrphanedRestore: false,
          fileCount: 2,
          commit: null,
          changeMap: null,
          unsummarizedHashes: [],
          rawChanges: [],
          originMessage: null,
          originHash: null,
        },
      ]);
      store.setGitStatus({
        files: [{ path: "modules/homebrew.nix", changeType: "edited" }],
        branch: "main",
        diff: "diff --git a/modules/homebrew.nix b/modules/homebrew.nix\n",
        additions: 1,
        deletions: 0,
        headCommitHash: currentHead,
        cleanHead: false,
        changes: [],
      });
    },
    setConfirmPrefs: (prefs) => {
      useWidgetStore.getState().initConfirmPrefs(prefs);
    },
    setSetupHosts: async (configDir: string, hostAttr: string) => {
      const normalizedDir = await darwinAPI.path.normalize(configDir);
      await darwinAPI.config.setDir(normalizedDir);
      await darwinAPI.config.setHostAttr("");
      const store = useWidgetStore.getState();
      store.setConfigDir(normalizedDir);
      store.setHost("");
      store.setHosts(hostAttr ? [hostAttr] : []);
    },
    saveSetupHost: async (hostAttr: string) => {
      const store = useWidgetStore.getState();
      const hosts = store.hosts.includes(hostAttr)
        ? store.hosts
        : [...store.hosts, hostAttr];
      store.setHosts(hosts);
      store.setHost(hostAttr);
    },
    captureProofPng: async (options) => {
      const target = getProofCaptureTarget(options);
      if (!target) {
        return null;
      }

      const { toPng } = await import("html-to-image");
      const bodyBackground = getComputedStyle(document.body).backgroundColor;
      const rect = target.getBoundingClientRect();
      return toPng(target, {
        backgroundColor:
          bodyBackground && bodyBackground !== "rgba(0, 0, 0, 0)"
            ? bodyBackground
            : "rgb(10, 10, 10)",
        cacheBust: !options?.includeAnnotations,
        width: Math.ceil(rect.width || target.scrollWidth || window.innerWidth),
        height: Math.ceil(rect.height || target.scrollHeight || window.innerHeight),
        pixelRatio: options?.pixelRatio ?? (options?.includeAnnotations ? 1 : 2),
      });
    },
  };

  window.__testWidget = helpers;
}

declare global {
  interface Window {
    __testWidget?: WidgetTestHelpers;
  }
}
