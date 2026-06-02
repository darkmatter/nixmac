import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type {
  NixDarwinRebuildEndEvent,
  NixInstallEndEvent,
  NixInstallProgressEvent,
} from "@/ipc/types";

const MANUAL_INSTALL_URL = "https://determinate.systems/nix-installer/";

export function getNixInstallErrorMessage(payload: NixInstallEndEvent["payload"]): string {
  const detail = payload.error?.trim();
  const fallback = `Installation failed. Retry the install, or install Nix manually from ${MANUAL_INSTALL_URL}.`;

  switch (payload.error_type) {
    case "download_failed":
      return `${detail ?? "Failed to download the Nix installer."} Check your internet connection and try again, or install Nix manually from ${MANUAL_INSTALL_URL}.`;
    case "installer_failed":
      return detail ?? `The macOS installer did not complete. Retry and approve the native admin prompt, or install Nix manually from ${MANUAL_INSTALL_URL}.`;
    case "timeout":
      return `${detail ?? "Nix installation timed out."} Check whether the macOS installer prompt is still open, then retry or install Nix manually from ${MANUAL_INSTALL_URL}.`;
    case "darwin_rebuild":
      return `${detail ?? "Nix installed, but nix-darwin setup failed."} Retry setup from nixmac, or install nix-darwin manually after installing Nix.`;
    case "internal":
      return detail ? `${detail} Retry the install, or install Nix manually from ${MANUAL_INSTALL_URL}.` : fallback;
    default:
      return detail ?? fallback;
  }
}

const checkNix = async () => {
    try {
      const result = await tauriAPI.nix.check();
      const store = useWidgetStore.getState();
      store.setNixInstalled(result.installed);
      store.setDarwinRebuildAvailable(result.installed ? result.darwinRebuildAvailable : null);
    } catch {
      useWidgetStore.getState().setNixInstalled(false);
    }
};

const installNix = async () => {
    const store = useWidgetStore.getState();
    store.setNixInstalling(true);
    store.setNixInstallPhase(null);
    store.setNixDownloadProgress(null);
    store.setError(null);

    const unlistenProgress = await ipcRenderer.on<NixInstallProgressEvent>("nix:install:progress", (event) => {
      const current = useWidgetStore.getState();
      current.setNixInstallPhase(event.payload.phase);
      if (event.payload.phase === "downloading" && event.payload.downloaded != null) {
        current.setNixDownloadProgress({
          downloaded: event.payload.downloaded,
          total: event.payload.total ?? 0,
        });
      }
    });

    const unlistenEnd = await ipcRenderer.on<NixInstallEndEvent>("nix:install:end", (event) => {
      const current = useWidgetStore.getState();
      current.setNixInstalling(false);
      current.setNixInstallPhase(null);
      current.setNixDownloadProgress(null);
      current.setNixInstalled(event.payload.ok);
      current.setDarwinRebuildAvailable(event.payload.darwin_rebuild_available ?? false);

      if (!event.payload.ok) {
        current.setError(getNixInstallErrorMessage(event.payload));
      }

      unlistenProgress();
      unlistenEnd();
    });

    try {
      await tauriAPI.nix.installStart();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setNixInstalling(false);
      store.setNixInstallPhase(null);
      store.setNixDownloadProgress(null);
      store.setError(msg);
      unlistenProgress();
      unlistenEnd();
    }
};

const prefetchDarwinRebuild = async () => {
    const store = useWidgetStore.getState();
    store.setDarwinRebuildPrefetching(true);
    store.setError(null);

    const unlistenEnd = await ipcRenderer.on<NixDarwinRebuildEndEvent>("nix:darwin-rebuild:end", (event) => {
      const current = useWidgetStore.getState();
      current.setDarwinRebuildPrefetching(false);
      current.setDarwinRebuildAvailable(event.payload.ok);

      if (!event.payload.ok) {
        current.setError(event.payload.error ?? "Failed to set up nix-darwin.");
      }

      unlistenEnd();
    });

    try {
      await tauriAPI.nix.prefetchDarwinRebuild();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setDarwinRebuildPrefetching(false);
      store.setError(msg);
      unlistenEnd();
    }
};

export function useNixInstall() {
  return { checkNix, installNix, prefetchDarwinRebuild };
}
