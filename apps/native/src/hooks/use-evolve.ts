import { slugify } from "@/components/widget/utils";
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
 * Creates a nixmac-evolve/* branch on first evolve and commits after each evolution.
 */
export function useEvolve() {
  const { refreshGitStatus } = useGitOperations();
  const { fetchSummary } = useSummary();

  const handleEvolve = useCallback(async () => {
    // Get fresh state each time
    const store = useWidgetStore.getState();
    if (!store.evolvePrompt.trim()) {
      return;
    }

    // Check if we need to create a branch (only if on main)
    const currentBranch = store.gitStatus?.current;
    const isOnMain = currentBranch === "main" || currentBranch === "master";
    const promptForBranch = store.evolvePrompt;

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
      // Run the evolution
      await darwinAPI.darwin.evolve(store.evolvePrompt);

      useWidgetStore.getState().appendLog("✓ Evolution complete\n");

      // Fetch summary first to get the commit message
      await fetchSummary();

      // Get the commit message from summary
      const summary = useWidgetStore.getState().summary;
      const commitMessage =
        summary?.commitMessage || "chore: evolve configuration";

      // Create branch if we're on main
      if (isOnMain) {
        const branchName = `nixmac-evolve/${slugify(promptForBranch)}`;
        useWidgetStore.getState().appendLog(`> Creating branch: ${branchName}\n`);
        await darwinAPI.git.checkoutNewBranch(branchName);
      }

      // Commit the changes
      useWidgetStore.getState().appendLog(`> Committing: ${commitMessage}\n`);
      await darwinAPI.git.commit(commitMessage);
      useWidgetStore.getState().appendLog("✓ Changes committed\n");

      store.setEvolvePrompt("");
      await refreshGitStatus({ cache: true });
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
  }, [refreshGitStatus, fetchSummary]);

  return { handleEvolve };
}
