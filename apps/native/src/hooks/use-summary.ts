import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import { mirrorChangeMapState } from "@/viewmodel/change-map";

type CommitMessageResult =
  | { status: "ready"; message: string }
  | { status: "pending" }
  | { status: "error" };

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 */
const findChangeMap = async (): Promise<void> => {
  try {
    const map = await tauriAPI.summarizedChanges.findChangeMap();
    if (map) {
      mirrorChangeMapState(map);
    }
  } catch (e) {
    console.error("[SemanticChangeMap] error", e);
  }
};

const generateCommitMessage = async (): Promise<CommitMessageResult> => {
  try {
    const message = await tauriAPI.summarizedChanges.generateCommitMessage();
    if (message?.trim()) {
      return { status: "ready", message };
    }
    return { status: "pending" };
  } catch {
    // Keep the last suggestion in place; the merge UI owns fallback display.
    return { status: "error" };
  }
};

const generateCurrentSummary = async () => {
  const { setSummarizing } = useWidgetStore.getState();
  setSummarizing(true);
  try {
    const map = await tauriAPI.summarizedChanges.summarizeCurrent();
    mirrorChangeMapState(map);
  } finally {
    setSummarizing(false);
  }
};

const summarizeOnFocus = () => {
  if (useWidgetStore.getState().autoSummarizeOnFocus) {
    generateCurrentSummary();
  }
};

export function useSummary() {
  return { findChangeMap, generateCommitMessage, generateCurrentSummary, summarizeOnFocus };
}
