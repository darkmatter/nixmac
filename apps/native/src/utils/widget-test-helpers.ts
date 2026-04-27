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
   * Restore setup host options without selecting or persisting a host.
   */
  restoreSetupHostOptions: (hostAttr: string) => Promise<void>;
  /**
   * Capture the most relevant proof surface as a PNG data URL.
   */
  captureProofPng: (options?: ProofCaptureOptions) => Promise<string | null>;
}

export interface ProofCaptureOptions {
  includeAnnotations?: boolean;
  pixelRatio?: number;
  targetSelector?: string;
}

type ProofActionState = {
  kind: string;
  label: string;
  value: string | null;
  x: number;
  y: number;
  updatedAt: number;
};

const INLINE_PROOF_ATTR = "data-nixmac-e2e-inline-proof";
const PROOF_TARGET_SELECTORS = [
  '[data-testid="feedback-dialog"]',
  '[data-testid="settings-dialog"]',
  '[data-testid="confirmation-dialog"]',
  '[data-testid="discard-uncommitted-dialog"]',
  '[data-testid="begin-evolve-warning"]',
  '[data-testid="history-step"]',
  '[data-testid="evolve-proof-region"]',
  '[data-testid="setup-step"]',
  '[data-testid="prompt-input-section"]',
  '[data-testid="widget-shell"]',
  "#root",
];

function isCapturableElement(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  for (let current: Element | null = node; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
  }

  return true;
}

function getProofTarget(): HTMLElement | null {
  for (const selector of PROOF_TARGET_SELECTORS) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node && isCapturableElement(node)) {
      return node;
    }
  }

  return null;
}

function getProofCaptureTarget(options?: ProofCaptureOptions): HTMLElement | null {
  if (options?.targetSelector) {
    const node = document.querySelector<HTMLElement>(options.targetSelector);
    return node && isCapturableElement(node) ? node : null;
  }

  return getProofTarget();
}

function getStoredProofAction(): ProofActionState | null {
  const action = window.__nixmacE2eProofAction;
  if (!action) return null;
  if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return null;
  return action;
}

function removeInlineProofAnnotations(target: HTMLElement) {
  target
    .querySelectorAll<HTMLElement>(`[${INLINE_PROOF_ATTR}]`)
    .forEach((node) => node.remove());
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function withInlineProofAnnotations<T>(
  target: HTMLElement,
  options: ProofCaptureOptions | undefined,
  capture: () => Promise<T>,
) {
  if (!options?.includeAnnotations) {
    return capture();
  }

  const action = getStoredProofAction();
  if (!action) {
    return capture();
  }

  const rect = target.getBoundingClientRect();
  const targetStyle = window.getComputedStyle(target);
  const previousPosition = target.style.position;
  const shouldRestorePosition = !previousPosition && targetStyle.position === "static";

  removeInlineProofAnnotations(target);

  if (shouldRestorePosition) {
    target.style.position = "relative";
  }

  const cursor = document.createElement("div");
  cursor.setAttribute(INLINE_PROOF_ATTR, "cursor");
  cursor.setAttribute("aria-hidden", "true");
  const cursorX = clamp(action.x - rect.left, 12, Math.max(12, rect.width - 12));
  const cursorY = clamp(action.y - rect.top, 12, Math.max(12, rect.height - 12));
  cursor.style.cssText = [
    "position:absolute",
    `left:${cursorX}px`,
    `top:${cursorY}px`,
    "width:22px",
    "height:22px",
    "border:2px solid #38d9ff",
    "border-radius:999px",
    "background:rgba(56,217,255,0.14)",
    "box-shadow:0 0 0 4px rgba(56,217,255,0.12),0 0 18px rgba(56,217,255,0.5)",
    "transform:translate(-35%,-35%)",
    "pointer-events:none",
    "z-index:2147483646",
  ].join(";");

  const cursorDot = document.createElement("div");
  cursorDot.style.cssText = [
    "position:absolute",
    "left:7px",
    "top:7px",
    "width:6px",
    "height:6px",
    "border-radius:999px",
    "background:#ffffff",
  ].join(";");
  cursor.appendChild(cursorDot);

  const overlay = document.createElement("div");
  overlay.setAttribute(INLINE_PROOF_ATTR, "action");
  overlay.setAttribute("aria-hidden", "true");
  const value = action.value ? `: ${action.value.slice(0, 90)}` : "";
  overlay.textContent = `${action.kind.toUpperCase()} ${action.label}${value}`;
  overlay.style.cssText = [
    "position:absolute",
    "left:10px",
    "bottom:10px",
    "max-width:min(760px,calc(100% - 20px))",
    "border:1px solid rgba(148,163,184,0.45)",
    "border-radius:8px",
    "background:rgba(15,23,42,0.88)",
    "color:#f8fafc",
    'font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    "letter-spacing:0",
    "padding:7px 10px",
    "pointer-events:none",
    "z-index:2147483647",
    "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
  ].join(";");

  target.append(cursor, overlay);

  try {
    return await capture();
  } finally {
    removeInlineProofAnnotations(target);
    if (shouldRestorePosition) {
      target.style.position = previousPosition;
    }
  }
}

type SetupHostSeed = {
  configDir: string;
  hostAttr: string;
  hosts: string[];
};

let setupHostSeed: SetupHostSeed | null = null;
let setupHostGuardUnsubscribe: (() => void) | null = null;
let setupHostGuardRestoring = false;

function restoreSeededSetupHostOptions() {
  const seed = setupHostSeed;
  if (!seed?.configDir || !seed.hostAttr) {
    return;
  }

  const store = useWidgetStore.getState();
  if (store.configDir !== seed.configDir) {
    return;
  }

  if (store.host && store.host !== seed.hostAttr) {
    return;
  }

  if (store.hosts.includes(seed.hostAttr)) {
    return;
  }

  store.setHosts(seed.hosts);
}

function preserveSetupHostOptions(seed: SetupHostSeed) {
  setupHostSeed = seed;
  restoreSeededSetupHostOptions();

  if (setupHostGuardUnsubscribe) {
    return;
  }

  setupHostGuardUnsubscribe = useWidgetStore.subscribe(() => {
    if (setupHostGuardRestoring) {
      return;
    }

    const seed = setupHostSeed;
    if (!seed) {
      return;
    }

    const state = useWidgetStore.getState();
    if (
      state.configDir !== seed.configDir ||
      (state.host && state.host !== seed.hostAttr) ||
      state.hosts.includes(seed.hostAttr)
    ) {
      return;
    }

    setupHostGuardRestoring = true;
    queueMicrotask(() => {
      try {
        restoreSeededSetupHostOptions();
      } finally {
        setupHostGuardRestoring = false;
      }
    });
  });
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
      const discoveredHosts = await darwinAPI.flake.listHosts();
      if (!discoveredHosts.includes(hostAttr)) {
        throw new Error(
          `E2E config host ${hostAttr} was not discovered; found: ${discoveredHosts.join(", ")}`,
        );
      }

      const store = useWidgetStore.getState();
      store.setConfigDir(normalizedDir);
      store.setHost("");
      store.setHosts(discoveredHosts);
      if (hostAttr) {
        // The real scanner already found this host. The guard only keeps the
        // visible select stable if startup refreshes clear hosts before WDIO
        // can click the option in an isolated scenario session.
        preserveSetupHostOptions({ configDir: normalizedDir, hostAttr, hosts: discoveredHosts });
      }
    },
    saveSetupHost: async (hostAttr: string) => {
      const store = useWidgetStore.getState();
      const hosts = store.hosts.includes(hostAttr)
        ? store.hosts
        : [...store.hosts, hostAttr];
      store.setHosts(hosts);
      store.setHost(hostAttr);
    },
    restoreSetupHostOptions: async (hostAttr: string) => {
      const store = useWidgetStore.getState();
      if (!setupHostSeed || setupHostSeed.hostAttr !== hostAttr) {
        throw new Error(
          `E2E setup host ${hostAttr} has not been verified by the flake host scanner`,
        );
      }
      if (store.configDir && hostAttr) {
        preserveSetupHostOptions(setupHostSeed);
      }
      restoreSeededSetupHostOptions();
    },
    captureProofPng: async (options) => {
      const target = getProofCaptureTarget(options);
      if (!target) {
        return null;
      }

      const { toPng } = await import("html-to-image");
      const bodyBackground = getComputedStyle(document.body).backgroundColor;
      const targetBackground = getComputedStyle(target).backgroundColor;
      const rect = target.getBoundingClientRect();
      const capture = () =>
        toPng(target, {
          backgroundColor:
            targetBackground && targetBackground !== "rgba(0, 0, 0, 0)"
              ? targetBackground
              : bodyBackground && bodyBackground !== "rgba(0, 0, 0, 0)"
                ? bodyBackground
                : "rgb(10, 10, 10)",
          cacheBust: !options?.includeAnnotations,
          width: Math.ceil(Math.max(rect.width, target.scrollWidth, target.offsetWidth, 1)),
          height: Math.ceil(Math.max(rect.height, target.scrollHeight, target.offsetHeight, 1)),
          pixelRatio: options?.pixelRatio ?? (options?.includeAnnotations ? 1.5 : 2),
        });

      return withInlineProofAnnotations(target, options, capture);
    },
  };

  window.__testWidget = helpers;
}

declare global {
  interface Window {
    __testWidget?: WidgetTestHelpers;
    __nixmacE2eProofAction?: ProofActionState;
  }
}
