import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI, EVOLVE_EVENT_CHANNEL, ipcRenderer, type EvolveEvent } from "@/tauri-api";
import { useCallback } from "react";
import { useGitOperations } from "./use-git-operations";
import { usePromptHistory } from "./use-prompt-history";
import { useSummary } from "./use-summary";

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
  const { findChangeMap } = useSummary();

  const evolveFromManual = useCallback(async () => {
    await darwinAPI.darwin.evolveFromManual();
  }, []);

  const buildCheck = useCallback(async () => {
    return await darwinAPI.darwin.buildCheck();
  }, []);

  const handleEvolve = useCallback(async () => {
    // Get fresh state each time
    const store = useWidgetStore.getState();
    if (!store.evolvePrompt.trim()) {
      return;
    }
    if (store.isProcessing && store.processingAction === "evolve") {
      return;
    }

    store.setProcessing(true, "evolve");
    store.setGenerating(true);
    store.setError(null);
    store.setExternalBuildDetected(false);
    store.clearEvolveEvents();
    store.clearLogs();
    store.clearPreview();
    store.setConversationalResponse(null);
    store.appendLog(`\n> Evolving: "${store.evolvePrompt}"\n`);

    let unlistenEvolve: (() => void) | null = null;

    try {
      await refreshPromptHistory(store.evolvePrompt.trim());

      // Set up evolve event listener
      unlistenEvolve = await ipcRenderer.on<EvolveEvent>(EVOLVE_EVENT_CHANNEL, (event) => {
        if (event.payload) {
          useWidgetStore.getState().appendEvolveEvent(event.payload);
          if (event.payload.raw) {
            useWidgetStore.getState().appendLog(`${event.payload.raw}\n`);
          }
        }
      });

      // Run the unified evolution workflow
      // Backend handles: AI + summary + branch + commit + DB
      const result = await darwinAPI.darwin.evolve(store.evolvePrompt);
      const isConversational = result?.telemetry?.state === "conversational";

      useWidgetStore.getState().appendLog("✓ Evolution complete\n");

      if (isConversational) {
        useWidgetStore.getState().setConversationalResponse(result.conversationalResponse ?? null);
      } else {
        store.setSummaryAvailable(true);
      }
      if (result?.gitStatus) {
        useWidgetStore.getState().setGitStatus(result.gitStatus);
      }
      if (result?.evolveState) {
        useWidgetStore.getState().setEvolveState(result.evolveState);
      }
      if (!isConversational && result?.changeMap) {
        useWidgetStore.getState().setChangeMap(result.changeMap);
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
      await findChangeMap();
    } finally {
      useWidgetStore.getState().setGenerating(false);
      useWidgetStore.getState().setProcessing(false, "evolve");
      unlistenEvolve?.();
    }
  }, [refreshGitStatus, refreshPromptHistory, findChangeMap]);

  return { handleEvolve, evolveFromManual, buildCheck };
}
