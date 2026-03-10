import { darwinAPI } from "@/tauri-api";
import { useWidgetStore } from "@/stores/widget-store";
import { useCallback, useEffect } from "react";

export function useHistory() {
  const setHistory = useWidgetStore((state) => state.setHistory);
  const setHistoryLoading = useWidgetStore((state) => state.setHistoryLoading);

  const load = useCallback(async () => {
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

  useEffect(() => {
    load();
  }, [load]);

  const generateFrom = useCallback(
    async (commitHash: string, number: number) => {
      await darwinAPI.history.generateFrom(commitHash, number);
      await load();
    },
    [load],
  );

  return { generateFrom };
}
