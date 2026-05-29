import type { FileDiffContents, GitStatus } from "@/ipc/types";
import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export const createGitSlice: StateCreator<WidgetStore, [], [], GitSlice> = (
  set,
) => ({
  ...initialGitState,

  setGitStatus: (gitStatus) => set({ gitStatus }),
  setFileDiffContents: (fileDiffContents) => set({ fileDiffContents }),
});

export type GitState = {
  gitStatus: GitStatus | null;
  fileDiffContents: Record<string, FileDiffContents>;
};

export type GitActions = {
  setGitStatus: (status: GitStatus | null) => void;
  setFileDiffContents: (contents: Record<string, FileDiffContents>) => void;
};

export type GitSlice = GitState & GitActions;

const initialGitState: GitState = {
  gitStatus: null,
  fileDiffContents: {},
};
