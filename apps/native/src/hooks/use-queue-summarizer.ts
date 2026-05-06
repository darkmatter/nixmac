import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import { ipcRenderer, type SummarizerUpdateEvent } from "@/tauri-api";
import { useCallback, useRef } from "react";

/**
 * Hook that subscribes to summarizer:update events emitted by the
 * queue_summarizer background service after each model call completes.
 */
export function useQueueSummarizer() {
  const { loadHistory } = useHistory();
  const unlistenRef = useRef<(() => void) | null>(null);
  const isSubscribingRef = useRef(false);

  const queueForSummaries = useCallback(() => {
    if (unlistenRef.current || isSubscribingRef.current) return;
    isSubscribingRef.current = true;

    const sub = ipcRenderer.on<SummarizerUpdateEvent>(
      "summarizer:update",
      (event) => {
        const store = useWidgetStore.getState();
        const map = event.payload.semanticMap;
        store.setChangeMap(map);
        if (store.showHistory) {
          loadHistory();
        }
      },
    );

    sub.then((unlisten) => {
      unlistenRef.current = unlisten;
      isSubscribingRef.current = false;
    });
  }, [loadHistory]);

  const unqueueForSummaries = useCallback(() => {
    isSubscribingRef.current = false;
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  return { queueForSummaries, unqueueForSummaries };
}
