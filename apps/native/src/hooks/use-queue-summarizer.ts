import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import type { SemanticChangeMap } from "@/types/shared";
import { ipcRenderer } from "@/tauri-api";
import { useCallback, useRef } from "react";

interface SummarizerEvent {
  semanticMap: SemanticChangeMap;
}

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

    const sub = ipcRenderer.on<SummarizerEvent>(
      "summarizer:update",
      (event) => {
        const store = useWidgetStore.getState();
        const map = event.payload.semanticMap;
        store.setChangeMap(map);
        store.setSummaryAvailable(
          map.groups.length > 0 || map.singles.length > 0,
        );
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
