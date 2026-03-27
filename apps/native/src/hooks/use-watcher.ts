import { useWidgetStore } from "@/stores/widget-store";
import type { WatcherEvent } from "@/tauri-api";
import { ipcRenderer } from "@/tauri-api";
import { useCallback, useRef } from "react";

/**
 * Hook that provides a function to start watching git status changes.
 * Call startWatching() after initialization to subscribe to backend events.
 */
export function useWatcher() {
  const unlistenRef = useRef<(() => void) | null>(null);
  const isSubscribingRef = useRef(false);

  const startWatching = useCallback(() => {
    // Avoid duplicate subscriptions (check both active and pending)
    if (unlistenRef.current || isSubscribingRef.current) return;
    isSubscribingRef.current = true;

    const gitStatusSub = ipcRenderer.on<WatcherEvent>(
      "git:status-changed",
      (event) => {
        const store = useWidgetStore.getState();
        if (!store.isProcessing && !store.isGenerating) {
          store.setGitStatus(event.payload.gitStatus);
          store.setChangeMap(event.payload.changeMap);
          const map = event.payload.changeMap;
          store.setSummaryAvailable(map.groups.length > 0 || map.singles.length > 0);
        }
      }
    );

    // Store unlisten for cleanup
    gitStatusSub.then((unlisten) => {
      unlistenRef.current = unlisten;
      isSubscribingRef.current = false;
    });
  }, []);

  const stopWatching = useCallback(() => {
    isSubscribingRef.current = false;
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  return { startWatching, stopWatching };
}
