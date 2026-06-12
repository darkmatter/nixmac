import { tauriAPI } from "@/ipc/api";
import { useViewModel } from "@/stores/view-model";
import { useUiState } from "@/stores/ui-state";
import { refreshHistorySnapshot } from "@/viewmodel/history";

const loadHistory = () => refreshHistorySnapshot();

const analyzeOne = async (hash: string) => {
  try {
    await tauriAPI.history.generateFrom(hash, 1);
    await loadHistory();
  } catch (e) {
    useUiState.getState().setError(`Failed to analyze changes: ${e}`);
  }
};

const analyzeMany = async (hashes: string[]) => {
  for (const hash of hashes) {
    useUiState.getState().addAnalyzingHistoryHash(hash);
  }
  for (const hash of hashes) {
    const store = useUiState.getState();
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
      useUiState.setState({ analyzingHistoryForHashes: new Set() });
      useUiState.getState().setError(`Failed to analyze changes: ${e}`);
      return;
    } finally {
      useUiState.getState().removeAnalyzingHistoryHash(hash);
    }
  }
};

const stopAnalyzing = () => {
  const current = useUiState.getState().analyzingHistoryForHashes;
  const [first] = current;
  useUiState.setState({ analyzingHistoryForHashes: new Set(first ? [first] : []) });
};

export function useHistory() {
  return { loadHistory, analyzeOne, analyzeMany, stopAnalyzing };
}
