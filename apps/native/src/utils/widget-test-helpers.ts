/**
 * Dev-only test helpers for driving the widget store from e2e tests.
 * Exposed on window.__testWidget so WDIO tests can call them via browser.execute.
 */

import { useWidgetStore } from "@/stores/widget-store";

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
   * Seed the setup step with an existing nix-darwin repository and discovered hosts.
   */
  setSetupHosts: (configDir: string, hostAttr: string) => void;
  /**
   * Capture the most relevant proof surface as a PNG data URL.
   */
  captureProofPng: () => Promise<string | null>;
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
    setSetupHosts: (configDir: string, hostAttr: string) => {
      const store = useWidgetStore.getState();
      store.setConfigDir(configDir);
      store.setHost("");
      store.setHosts(hostAttr ? [hostAttr] : []);
    },
    captureProofPng: async () => {
      const target = getProofTarget();
      if (!target) {
        return null;
      }

      const { toPng } = await import("html-to-image");
      const bodyBackground = getComputedStyle(document.body).backgroundColor;
      return toPng(target, {
        backgroundColor:
          bodyBackground && bodyBackground !== "rgba(0, 0, 0, 0)"
            ? bodyBackground
            : "rgb(10, 10, 10)",
        cacheBust: true,
        pixelRatio: 2,
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
