import { useWidgetStore } from "@/stores/widget-store";
import {
  darwinAPI,
  EVOLVE_EVENT_CHANNEL,
  ipcRenderer,
  type EvolveEvent,
} from "@/tauri-api";
import { useCallback } from "react";
import { useGitOperations } from "./use-git-operations";
import { usePromptHistory } from "./use-prompt-history";

/**
 * Hook for the evolution operation.
 * Handles AI-driven configuration evolution with event streaming.
 *
 * The backend now handles the complete workflow:
 * - AI evolution
 * - Summary generation
 * - Branch creation (if on main)
 * - Committing changes
 * - Database storage
 * - Returns summary and final git status
 */
export function useEvolve() {
  const { refreshGitStatus } = useGitOperations();
  const { refreshPromptHistory } = usePromptHistory();

  const handleEvolve = useCallback(async () => {
    // Get fresh state each time
    const store = useWidgetStore.getState();
    if (!store.evolvePrompt.trim()) {
      return;
    }

    await refreshPromptHistory(store.evolvePrompt.trim());

    store.setProcessing(true, "evolve");
    store.setGenerating(true);
    store.setError(null);
    store.clearEvolveEvents();
    store.clearLogs();
    store.clearPreview();
    store.appendLog(`\n> Evolving: "${store.evolvePrompt}"\n`);

    // Set up evolve event listener
    const unlistenEvolve = await ipcRenderer.on<EvolveEvent>(
      EVOLVE_EVENT_CHANNEL,
      (event) => {
        if (event.payload) {
          useWidgetStore.getState().appendEvolveEvent(event.payload);
          if (event.payload.raw) {
            useWidgetStore.getState().appendLog(`${event.payload.raw}\n`);
          }
        }
      }
    );

    try {
      // Run the unified evolution workflow
      // Backend handles: AI + summary + branch + commit + DB
      const result = await darwinAPI.darwin.evolve(store.evolvePrompt);

      useWidgetStore.getState().appendLog("✓ Evolution complete\n");

      // Set the summary and git status from the result
      if (result?.summary) {
        useWidgetStore.getState().setSummary(result.summary);
      }
      if (result?.gitStatus) {
        useWidgetStore.getState().setGitStatus(result.gitStatus);
      }

      store.setEvolvePrompt("");
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);

      console.error("[useEvolve] Evolution failed:", {
        error: e,
        message: msg,
        stack: (e as Error)?.stack,
        timestamp: new Date().toISOString(),
      });

      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
    } finally {
      useWidgetStore.getState().setGenerating(false);
      unlistenEvolve();
      // Delay setProcessing(false) to let any pending watcher events pass
      // Watcher polls every 2.5s, so 3s ensures we catch any updates
      setTimeout(() => {
        useWidgetStore.getState().setProcessing(false);
      }, 3000);
    }
  }, [refreshGitStatus, refreshPromptHistory]);

  return { handleEvolve };
}
