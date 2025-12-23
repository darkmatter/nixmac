import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// ----------------------------------------------------------------------------
// App Slice
// ----------------------------------------------------------------------------
export interface AppState {
  activeEvolutionId: string | null;
  consoleLogs: string[];
  setEvolutionId: (id: string | null) => void;
  addConsoleLog: (log: string) => void;
  clearConsoleLogs: () => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      immer((set) => ({
        activeEvolutionId: null,
        consoleLogs: [],
        setEvolutionId: (id: string | null) => set({ activeEvolutionId: id }),
        addConsoleLog: (log) =>
          set((state) => {
            state.consoleLogs.push(log);
          }),
        clearConsoleLogs: () => set({ consoleLogs: [] }),
      })),
      { name: "app-state" },
    ),
  ),
);
