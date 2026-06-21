/**
 * Dev-only test helpers for driving the widget store from e2e tests.
 * Exposed on window.__testWidget so WDIO tests can call them via browser.execute.
 */

import { useUiState } from "@nixmac/state";
import { useViewModel } from "@nixmac/state";
import { clearChangeMap } from "@/viewmodel/change-map";
import { clearEvolveEvents } from "@/viewmodel/evolution";
import { refreshEvolveSnapshot } from "@/viewmodel/evolve";
import { refreshGitSnapshot } from "@/viewmodel/git";
import { clearRebuildLog } from "@/viewmodel/rebuild";

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
      return [...useViewModel.getState().promptHistory];
    },
    getChangeMap: () => {
      return JSON.stringify(useViewModel.getState().changeMap);
    },
    resetForTest: () => {
      const ui = useUiState.getState();
      ui.setEvolvePrompt("");
      ui.clearLogs();
      clearEvolveEvents();
      ui.setConversationalResponse(null);
      ui.setCommitMessageSuggestion(null);
      clearChangeMap();
      ui.setError(null);
      clearRebuildLog();
      ui.setRebuildPanelDismissed(false);
      ui.setRebuildContext("apply");
    },
    refreshGitStatus: async () => {
      // Best-effort, like the rest of the reset helpers: a refresh failure
      // should surface in assertions, not crash the browser.execute call.
      await refreshGitSnapshot().catch(console.error);
      await refreshEvolveSnapshot().catch(console.error);
    },
  };

  window.__testWidget = helpers;
}

declare global {
  interface Window {
    __testWidget?: WidgetTestHelpers;
  }
}
