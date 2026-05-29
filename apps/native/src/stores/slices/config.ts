import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export const createConfigSlice: StateCreator<
  WidgetStore,
  [],
  [],
  ConfigSlice
> = (set) => ({
  ...initialConfigState,

  setConfigDir: (configDir) => set({ configDir }),
  setHosts: (hosts) => set({ hosts }),
  setHost: (host) => set({ host }),
});

export type ConfigState = {
  configDir: string;
  hosts: string[];
  host: string;
};

export type ConfigActions = {
  setConfigDir: (dir: string) => void;
  setHosts: (hosts: string[]) => void;
  setHost: (host: string) => void;
};

export type ConfigSlice = ConfigState & ConfigActions;

const initialConfigState: ConfigState = {
  configDir: "",
  hosts: [],
  host: "",
};
