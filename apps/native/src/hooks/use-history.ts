import { tauriAPI } from "@/ipc/api";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";

const loadHistory = async () => {
  try {
    const items = await tauriAPI.history.get();
    useViewModel.setState({ history: items });
  } catch (e) {
    console.error("[useHistory] get failed:", e);
  }
};

const analyzeOne = async (hash: string) => {
  try {
    await tauriAPI.history.generateFrom(hash, 1);
    await loadHistory();
  } catch (e) {
    useWidgetStore.getState().setError(`Failed to analyze changes: ${e}`);
  }
};

const analyzeMany = async (hashes: string[]) => {
  for (const hash of hashes) {
    useWidgetStore.getState().addAnalyzingHistoryHash(hash);
  }
  for (const hash of hashes) {
    const store = useWidgetStore.getState();
    if (!store.analyzingHistoryForHashes.has(hash)) break;
    const item = useViewModel.getState().history.find((h) => h.hash === hash);
    if (item?.changeMap && item.unsummarizedHashes.length === 0) {
      store.removeAnalyzingHistoryHash(hash);
      continue;
    }
    try {
      await tauriAPI.history.generateFrom(hash, 1);
      await loadHistory();
    } catch (e) {
      useWidgetStore.setState({ analyzingHistoryForHashes: new Set() });
      useWidgetStore.getState().setError(`Failed to analyze changes: ${e}`);
      return;
    } finally {
      useWidgetStore.getState().removeAnalyzingHistoryHash(hash);
    }
  }
};

const stopAnalyzing = () => {
  const current = useWidgetStore.getState().analyzingHistoryForHashes;
  const [first] = current;
  useWidgetStore.setState({ analyzingHistoryForHashes: new Set(first ? [first] : []) });
};

export function useHistory() {
  return { loadHistory, analyzeOne, analyzeMany, stopAnalyzing };
}
