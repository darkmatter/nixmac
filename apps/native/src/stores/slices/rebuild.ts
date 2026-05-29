import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export type RebuildErrorType =
  | "infinite_recursion"
  | "evaluation_error"
  | "build_error"
  | "full_disk_access"
  | "user_cancelled"
  | "authorization_denied"
  | "generic_error";

export type RebuildLine = {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
};

export type RebuildContext = "rollback" | "apply";

export type RebuildState = {
  isRunning: boolean;
  context: RebuildContext;
  lines: RebuildLine[];
  rawLines: string[];
  exitCode?: number;
  success?: boolean;
  errorType?: RebuildErrorType;
  errorMessage?: string;
};

export const createRebuildSlice: StateCreator<
  WidgetStore,
  [],
  [],
  RebuildSlice
> = (set) => ({
  ...initialRebuildSliceState,

  startRebuild: (context) =>
    set({
      rebuild: {
        isRunning: true,
        context,
        lines: [{ id: 0, text: "Preparing rebuild...", type: "info" }],
        rawLines: [],
        exitCode: undefined,
        success: undefined,
        errorType: undefined,
        errorMessage: undefined,
      },
    }),
  appendRebuildLine: (line) =>
    set((state) => ({
      rebuild: {
        ...state.rebuild,
        lines: [...state.rebuild.lines, line].slice(-50), // Keep last 50 lines
      },
    })),
  appendRawLine: (line) =>
    set((state) => ({
      rebuild: {
        ...state.rebuild,
        rawLines: [...state.rebuild.rawLines, line].slice(-500), // Keep last 500 raw lines
      },
    })),
  setRebuildError: (errorType, errorMessage) =>
    set((state) => ({
      rebuild: {
        ...state.rebuild,
        errorType,
        errorMessage,
      },
    })),
  setRebuildComplete: (success, exitCode) =>
    set((state) => ({
      rebuild: {
        ...state.rebuild,
        isRunning: false,
        success,
        exitCode,
      },
    })),
  clearRebuild: () => set({ rebuild: initialRebuildSubstate }),
  setExternalBuildDetected: (externalBuildDetected) =>
    set({ externalBuildDetected }),
});

export type RebuildSliceState = {
  rebuild: RebuildState;
  externalBuildDetected: boolean;
};

export type RebuildActions = {
  startRebuild: (context: RebuildContext) => void;
  appendRebuildLine: (line: RebuildLine) => void;
  appendRawLine: (line: string) => void;
  setRebuildError: (errorType: RebuildErrorType, errorMessage: string) => void;
  setRebuildComplete: (success: boolean, exitCode?: number) => void;
  clearRebuild: () => void;
  setExternalBuildDetected: (detected: boolean) => void;
};

export type RebuildSlice = RebuildSliceState & RebuildActions;

export const initialRebuildSubstate: RebuildState = {
  isRunning: false,
  context: "apply",
  lines: [],
  rawLines: [],
  exitCode: undefined,
  success: undefined,
  errorType: undefined,
  errorMessage: undefined,
};

const initialRebuildSliceState: RebuildSliceState = {
  rebuild: initialRebuildSubstate,
  externalBuildDetected: false,
};
