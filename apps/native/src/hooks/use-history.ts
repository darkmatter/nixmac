import { darwinAPI } from "@/tauri-api";
import { useWidgetStore } from "@/stores/widget-store";
import { useCallback } from "react";

export function useHistory() {
  const setHistory = useWidgetStore((state) => state.setHistory);
  const setHistoryLoading = useWidgetStore((state) => state.setHistoryLoading);
  const addAnalyzingHistoryHash = useWidgetStore((state) => state.addAnalyzingHistoryHash);
  const removeAnalyzingHistoryHash = useWidgetStore((state) => state.removeAnalyzingHistoryHash);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const items = await darwinAPI.history.get();
      setHistory(items);
    } catch (e) {
      console.error("[useHistory] get failed:", e);
    } finally {
      setHistoryLoading(false);
    }
  }, [setHistory, setHistoryLoading]);

  const analyzeOne = useCallback(
    async (hash: string) => {
      await darwinAPI.history.generateFrom(hash, 1);
      await loadHistory();
    },
    [loadHistory],
  );

  const analyzeMany = useCallback(
    async (hashes: string[]) => {
      for (const hash of hashes) {
        addAnalyzingHistoryHash(hash);
      }
      for (const hash of hashes) {
        if (!useWidgetStore.getState().analyzingHistoryForHashes.has(hash)) break;
        try {
          await darwinAPI.history.generateFrom(hash, 1);
          await loadHistory();
        } finally {
          removeAnalyzingHistoryHash(hash);
        }
      }
    },
    [addAnalyzingHistoryHash, removeAnalyzingHistoryHash, loadHistory],
  );

  const stopAnalyzing = useCallback(() => {
    const current = useWidgetStore.getState().analyzingHistoryForHashes;
    const [first] = current;
    useWidgetStore.setState({ analyzingHistoryForHashes: new Set(first ? [first] : []) });
  }, []);

  return { loadHistory, analyzeOne, analyzeMany, stopAnalyzing };
}
