import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export const createConsoleSlice: StateCreator<
  WidgetStore,
  [],
  [],
  ConsoleSlice
> = (set) => ({
  ...initialConsoleState,

  appendLog: (text) =>
    set((state) => ({ consoleLogs: state.consoleLogs + text })),
  clearLogs: () => set({ consoleLogs: "" }),
});

export type ConsoleState = {
  consoleLogs: string;
};

export type ConsoleActions = {
  appendLog: (text: string) => void;
  clearLogs: () => void;
};

export type ConsoleSlice = ConsoleState & ConsoleActions;

const initialConsoleState: ConsoleState = {
  consoleLogs: "",
};
