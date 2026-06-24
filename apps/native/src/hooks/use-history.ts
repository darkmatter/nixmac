import { tauriAPI } from "@/ipc/api";
import { uiActions, useUiState, viewModelActions } from "@nixmac/state";
import { refreshHistorySnapshot } from "@/viewmodel/history";

const loadHistory = () => refreshHistorySnapshot();

const analyzeOne = async (hash: string) => {
  try {
    await tauriAPI.history.generateFrom(hash, 1);
    await loadHistory();
  } catch (e) {
    uiActions.setError(`Failed to analyze changes: ${e}`);
  }
};

const analyzeMany = async (hashes: string[]) => {
  for (const hash of hashes) {
    uiActions.addAnalyzingHistoryHash(hash);
  }
  for (const hash of hashes) {
    const store = useUiState.getState();
    if (!store.analyzingHistoryForHashes.has(hash)) break;
    const item = viewModelActions.getState().history.find((h) => h.hash === hash);
    if (item?.changeMap && item.unsummarizedHashes.length === 0) {
      uiActions.removeAnalyzingHistoryHash(hash);
      continue;
    }
    try {
      await tauriAPI.history.generateFrom(hash, 1);
      await loadHistory();
    } catch (e) {
      uiActions.setState({ analyzingHistoryForHashes: new Set() });
      uiActions.setError(`Failed to analyze changes: ${e}`);
      return;
    } finally {
      uiActions.removeAnalyzingHistoryHash(hash);
    }
  }
};

const stopAnalyzing = () => {
  const current = useUiState.getState().analyzingHistoryForHashes;
  const [first] = current;
  uiActions.setState({ analyzingHistoryForHashes: new Set(first ? [first] : []) });
};

export function useHistory() {
  return { loadHistory, analyzeOne, analyzeMany, stopAnalyzing };
}
