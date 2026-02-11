import { useWidgetStore } from "@/stores/widget-store";
import { ipcRenderer } from "@/tauri-api";
import type { GitStatus } from "@/tauri-api";
import { useCallback, useRef } from "react";

/**
 * Hook that provides a function to start watching git status changes.
 * Call startWatching() after initialization to subscribe to backend events.
 */
export function useWatcher() {
  const unlistenRef = useRef<(() => void) | null>(null);

  const startWatching = useCallback(() => {
    // Avoid duplicate subscriptions
    if (unlistenRef.current) return;

    const gitStatusSub = ipcRenderer.on<{ status: GitStatus }>(
      "git:status-changed",
      (event) => {
        const store = useWidgetStore.getState();

        // Skip entirely if UI is actively making changes
        // (evolve/apply/commit operations handle their own status refresh when complete)
        if (store.isProcessing || store.isGenerating) {
          console.log("Change event received, ignoring (UI operation in progress)");
          return;
        }

        // Update git status
        store.setGitStatus(event.payload.status);

        // Mark summary as stale - UI decides when to refresh
        console.log("Change event received, marking summary stale");
        store.setSummaryStale(true);
      }
    );

    // Store unlisten for cleanup
    gitStatusSub.then((unlisten) => {
      unlistenRef.current = unlisten;
    });
  }, []);

  const stopWatching = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  return { startWatching, stopWatching };
}
