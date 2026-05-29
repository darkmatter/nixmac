import type { SemanticChangeMap } from "@/ipc/types";
import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export const createSummarySlice: StateCreator<
  WidgetStore,
  [],
  [],
  SummarySlice
> = (set) => ({
  ...initialSummaryState,

  setChangeMap: (changeMap) => set({ changeMap }),
  setCommitMessageSuggestion: (commitMessageSuggestion) =>
    set({ commitMessageSuggestion }),
  setSummarizing: (isSummarizing) => set({ isSummarizing }),
  setGenerating: (isGenerating) => set({ isGenerating }),
});

export type SummaryState = {
  changeMap: SemanticChangeMap | null;
  commitMessageSuggestion: string | null;
  isSummarizing: boolean;
  isGenerating: boolean;
};

export type SummaryActions = {
  setChangeMap: (map: SemanticChangeMap | null) => void;
  setCommitMessageSuggestion: (msg: string | null) => void;
  setSummarizing: (summarizing: boolean) => void;
  setGenerating: (generating: boolean) => void;
};

export type SummarySlice = SummaryState & SummaryActions;

const initialSummaryState: SummaryState = {
  changeMap: null,
  commitMessageSuggestion: null,
  isSummarizing: false,
  isGenerating: false,
};
