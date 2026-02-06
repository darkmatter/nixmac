import { useWidgetStore } from "@/stores/widget-store";
import { ipcRenderer } from "@/tauri-api";
import type { GitStatus } from "@/tauri-api";
import { useCallback, useRef } from "react";
import { useSummary } from "./use-summary";

/**
 * Hook that provides a function to start watching git status changes.
 * Call startWatching() after initialization to subscribe to backend events.
 */
export function useWatcher() {
  const { checkAndFetchSummary } = useSummary();
  const unlistenRef = useRef<(() => void) | null>(null);

  const startWatching = useCallback(() => {
    // Avoid duplicate subscriptions
    if (unlistenRef.current) return;

    const gitStatusSub = ipcRenderer.on<{ status: GitStatus }>(
      "git:status-changed",
      (event) => {
        useWidgetStore.getState().setGitStatus(event.payload.status);
        checkAndFetchSummary();
      }
    );

    // Store unlisten for cleanup
    gitStatusSub.then((unlisten) => {
      unlistenRef.current = unlisten;
    });
  }, [checkAndFetchSummary]);

  const stopWatching = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  return { startWatching, stopWatching };
}
