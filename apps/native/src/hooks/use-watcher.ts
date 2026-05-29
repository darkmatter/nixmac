import { useHistory } from "@/hooks/use-history";
import { ipcRenderer } from "@/ipc/api";
import type { WatcherEvent } from "@/ipc/types";
import { useFeedbackStore } from "@/stores/feedback-store";
import { useUiStore } from "@/stores/ui-store";
import { useWidgetStore } from "@/stores/widget-store";
import { useRef } from "react";

/**
 * Hook that provides a function to start watching git status changes.
 * Call startWatching() after initialization to subscribe to backend events.
 */
export function useWatcher() {
  const { loadHistory } = useHistory();
  const unlistenRef = useRef<(() => void) | null>(null);
  const isSubscribingRef = useRef(false);

  const startWatching = () => {
    // Avoid duplicate subscriptions (check both active and pending)
    if (unlistenRef.current || isSubscribingRef.current) return;
    isSubscribingRef.current = true;

    const gitStatusSub = ipcRenderer.on<WatcherEvent>(
      "git:status-changed",
      (event) => {
        const {
          error,
          gitStatus,
          changeMap,
          evolveState,
          externalBuildDetected,
        } = event.payload;

        if (error) {
          useFeedbackStore.getState().setError(error);
          if (error.includes("is not a git repository")) {
            useWidgetStore.getState().setHosts([]);
          }
          return;
        }

        const store = useWidgetStore.getState();
        const ui = useUiStore.getState();
        if (!ui.isProcessing && !store.isGenerating) {
          store.setGitStatus(gitStatus ?? null);
          if (changeMap) {
            store.setChangeMap(changeMap);
          }
          if (evolveState) {
            store.setEvolveState(evolveState);
          }
          store.setExternalBuildDetected(externalBuildDetected);
          if (ui.showHistory) {
            loadHistory();
          }
        }
      },
    );

    // Store unlisten for cleanup
    gitStatusSub.then((unlisten) => {
      unlistenRef.current = unlisten;
      isSubscribingRef.current = false;
    });
  };

  const stopWatching = () => {
    isSubscribingRef.current = false;
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  };

  return { startWatching, stopWatching };
}
