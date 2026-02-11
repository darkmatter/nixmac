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

        // Non-manual updates should refresh git status and summary independent of watcher
        if (store.isProcessing || store.isGenerating) {
          return;
        }

        store.setGitStatus(event.payload.status);
        
        // We can notify the user to update their summary
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
