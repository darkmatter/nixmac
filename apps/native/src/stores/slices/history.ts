import type { HistoryItem } from "@/ipc/types";
import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export const createHistorySlice: StateCreator<
  WidgetStore,
  [],
  [],
  HistorySlice
> = (set) => ({
  ...initialHistoryState,

  setHistory: (history) => set({ history }),
  setHistoryLoading: (historyLoading) => set({ historyLoading }),
  addAnalyzingHistoryHash: (hash) =>
    set((state) => ({
      analyzingHistoryForHashes: new Set([
        ...state.analyzingHistoryForHashes,
        hash,
      ]),
    })),
  removeAnalyzingHistoryHash: (hash) =>
    set((state) => {
      const next = new Set(state.analyzingHistoryForHashes);
      next.delete(hash);
      return { analyzingHistoryForHashes: next };
    }),
});

export type HistoryState = {
  history: HistoryItem[];
  historyLoading: boolean;
  analyzingHistoryForHashes: Set<string>;
};

export type HistoryActions = {
  setHistory: (history: HistoryItem[]) => void;
  setHistoryLoading: (loading: boolean) => void;
  addAnalyzingHistoryHash: (hash: string) => void;
  removeAnalyzingHistoryHash: (hash: string) => void;
};

export type HistorySlice = HistoryState & HistoryActions;

const initialHistoryState: HistoryState = {
  history: [],
  historyLoading: false,
  analyzingHistoryForHashes: new Set<string>(),
};
