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
   * Reset transient client-side widget state between e2e tests.
   */
  resetForTest: () => void;
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
    resetForTest: () => {
      const state = useWidgetStore.getState();
      state.setEvolvePrompt("");
      state.setPromptHistory([]);
      state.clearPreview();
      state.clearLogs();
      state.clearEvolveEvents();
      state.setConversationalResponse(null);
      state.setCommitMessageSuggestion(null);
      state.setChangeMap(null);
      state.setError(null);
      state.clearRebuild();
    },
  };

  window.__testWidget = helpers;
}

declare global {
  interface Window {
    __testWidget?: WidgetTestHelpers;
  }
}
