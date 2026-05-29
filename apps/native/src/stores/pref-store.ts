import type { UpdateChannel } from "@/ipc/types";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type ConfirmPrefKey =
  | "confirmBuild"
  | "confirmClear"
  | "confirmRollback";
export type BoolPrefKey =
  | ConfirmPrefKey
  | "autoSummarizeOnFocus"
  | "scanHomebrewOnStartup"
  | "defaultToDiffTab";

export type PrefState = {
  confirmBuild: boolean;
  confirmClear: boolean;
  confirmRollback: boolean;
  autoSummarizeOnFocus: boolean;
  scanHomebrewOnStartup: boolean;
  defaultToDiffTab: boolean;
  developerMode: boolean;
  pinnedVersion: string | null;
  updateChannel: UpdateChannel;
  prefsLoaded: boolean;
};

export type PrefActions = {
  setBoolPref: (key: BoolPrefKey, value: boolean) => void;
  initConfirmPrefs: (prefs: Partial<Record<ConfirmPrefKey, boolean>>) => void;
  setAutoSummarizeOnFocus: (value: boolean) => void;
  setDeveloperMode: (value: boolean) => void;
  setPinnedVersion: (value: string | null) => void;
  setUpdateChannel: (value: UpdateChannel) => void;
  setPrefsLoaded: (loaded: boolean) => void;
};

export type PrefStore = PrefState & PrefActions;

const initialPreferencesState: PrefState = {
  confirmBuild: true,
  confirmClear: true,
  confirmRollback: true,
  autoSummarizeOnFocus: false,
  scanHomebrewOnStartup: true,
  defaultToDiffTab: false,
  developerMode: false,
  pinnedVersion: null,
  updateChannel: "stable",
  prefsLoaded: false,
};

export function createPrefStore(initial?: Partial<PrefStore>) {
  return create<PrefStore>()(
    devtools(
      (set) => ({
        ...initialPreferencesState,
        ...initial,

        setBoolPref: (key, value) =>
          set({ [key]: value } as Partial<PrefStore>),
        initConfirmPrefs: (prefs) =>
          set({
            confirmBuild: prefs.confirmBuild ?? true,
            confirmClear: prefs.confirmClear ?? true,
            confirmRollback: prefs.confirmRollback ?? true,
          }),
        setAutoSummarizeOnFocus: (value) =>
          set({ autoSummarizeOnFocus: value }),
        setDeveloperMode: (value) => set({ developerMode: value }),
        setPinnedVersion: (value) => set({ pinnedVersion: value }),
        setUpdateChannel: (value) => set({ updateChannel: value }),
        setPrefsLoaded: (prefsLoaded) => set({ prefsLoaded }),
      }),
      { name: "pref-store", enabled: import.meta.env.DEV },
    ),
  );
}

export const usePrefStore = createPrefStore();
