/**
 * Dev-only test helpers for driving the widget store from e2e tests.
 * Exposed on window.__testWidget so WDIO tests can call them via browser.execute.
 */

import { refreshGitStatus } from "@/hooks/use-git-operations";
import { loadEvolveState } from "@/hooks/use-widget-initialization";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { mirrorChangeMapState } from "@/viewmodel/change-map";

interface WidgetTestHelpers {
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
   * Returns the current change map serialized as JSON, for
   * comparison across browser.execute boundaries.
   */
  getChangeMap: () => string;
  /**
   * Reset transient client-side widget state between e2e tests.
   */
  resetForTest: () => void;
  /**
   * Re-run git_status and recompute evolve routing state against the live
   * config repo, writing both to the store. Used by tests that mutate the
   * on-disk repo and need the widget to pick up the new state without leaning
   * on filesystem-watcher timing.
   */
  refreshGitStatus: () => Promise<void>;
}

export function setupWidgetTestHelpers() {
  if (typeof window === "undefined") return;

  const helpers: WidgetTestHelpers = {
    setEvolvePrompt: (value: string) => {
      useUiState.getState().setEvolvePrompt(value);
    },
    isEvolveProcessing: () => {
      const state = useUiState.getState();
      return state.isProcessing && state.processingAction === "evolve";
    },
    getPromptHistory: () => {
      return [...(useWidgetStore.getState().promptHistory ?? [])];
    },
    getChangeMap: () => {
      return JSON.stringify(useViewModel.getState().changeMap);
    },
    resetForTest: () => {
      const state = useWidgetStore.getState();
      const ui = useUiState.getState();
      ui.setEvolvePrompt("");
      state.setPromptHistory([]);
      ui.clearLogs();
      state.clearEvolveEvents();
      state.setConversationalResponse(null);
      ui.setCommitMessageSuggestion(null);
      mirrorChangeMapState(null);
      ui.setError(null);
      state.clearRebuild();
    },
    refreshGitStatus: async () => {
      await refreshGitStatus();
      await loadEvolveState();
    },
  };

  window.__testWidget = helpers;
}

declare global {
  interface Window {
    __testWidget?: WidgetTestHelpers;
  }
}
