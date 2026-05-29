import type { PermissionsState } from "@/ipc/types";
import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export const createSetupSlice: StateCreator<WidgetStore, [], [], SetupSlice> = (
  set,
) => ({
  ...initialSetupState,

  setPermissionsState: (permissionsState) => set({ permissionsState }),
  setPermissionsChecked: (permissionsChecked) => set({ permissionsChecked }),
  setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
  setNixInstalled: (nixInstalled) => set({ nixInstalled }),
  setNixInstalling: (nixInstalling) => set({ nixInstalling }),
  setNixInstallPhase: (nixInstallPhase) => set({ nixInstallPhase }),
  setNixDownloadProgress: (nixDownloadProgress) => set({ nixDownloadProgress }),
  setDarwinRebuildAvailable: (darwinRebuildAvailable) =>
    set({ darwinRebuildAvailable }),
});

type NixInstallPhase =
  | "downloading"
  | "waiting-for-installer"
  | "prefetching"
  | null;
type NixDownloadProgress = { downloaded: number; total: number } | null;

export type SetupState = {
  permissionsState: PermissionsState | null;
  permissionsChecked: boolean;
  isBootstrapping: boolean;
  nixInstalled: boolean | null;
  nixInstalling: boolean;
  nixInstallPhase: NixInstallPhase;
  nixDownloadProgress: NixDownloadProgress;
  darwinRebuildAvailable: boolean | null;
};

export type SetupActions = {
  setPermissionsState: (state: PermissionsState | null) => void;
  setPermissionsChecked: (checked: boolean) => void;
  setBootstrapping: (isBootstrapping: boolean) => void;
  setNixInstalled: (installed: boolean | null) => void;
  setNixInstalling: (installing: boolean) => void;
  setNixInstallPhase: (phase: NixInstallPhase) => void;
  setNixDownloadProgress: (progress: NixDownloadProgress) => void;
  setDarwinRebuildAvailable: (available: boolean | null) => void;
};

export type SetupSlice = SetupState & SetupActions;

const initialSetupState: SetupState = {
  permissionsState: null,
  permissionsChecked: false,
  isBootstrapping: false,
  nixInstalled: null,
  nixInstalling: false,
  nixInstallPhase: null,
  nixDownloadProgress: null,
  darwinRebuildAvailable: null,
};
