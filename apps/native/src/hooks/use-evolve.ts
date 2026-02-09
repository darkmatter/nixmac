import { useWidgetStore } from "@/stores/widget-store";
import {
  darwinAPI,
  EVOLVE_EVENT_CHANNEL,
  ipcRenderer,
  type EvolveEvent,
} from "@/tauri-api";
import { useCallback } from "react";
import { useGitOperations } from "./use-git-operations";
import { useSummary } from "./use-summary";

/**
 * Hook for the evolution operation.
 * Handles AI-driven configuration evolution with event streaming.
 */
export function useEvolve() {
  const { refreshGitStatus } = useGitOperations();
  const { checkAndFetchSummary } = useSummary();

  const handleEvolve = useCallback(async () => {
    // Get fresh state each time
    const store = useWidgetStore.getState();
    if (!store.evolvePrompt.trim()) {
      return;
    }

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
      await darwinAPI.darwin.evolve(store.evolvePrompt);

      useWidgetStore.getState().appendLog("✓ Evolution complete\n");
      store.setEvolvePrompt("");

      await refreshGitStatus();
      await checkAndFetchSummary({ skipCheck: true });

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
      useWidgetStore.getState().setProcessing(false);
      useWidgetStore.getState().setGenerating(false);
      unlistenEvolve();
    }
  }, [refreshGitStatus, checkAndFetchSummary]);

  return { handleEvolve };
}
