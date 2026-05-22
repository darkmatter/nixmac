import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI, ipcRenderer } from "@/tauri-api";
import type {
  NixDarwinRebuildEndEvent,
  NixInstallEndEvent,
  NixInstallProgressEvent,
} from "@/types/shared";

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
        current.setError(
          event.payload.error ?? "Installation failed. Please install manually.",
        );
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
