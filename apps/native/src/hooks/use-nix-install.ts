import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI, ipcRenderer } from "@/tauri-api";
import { useCallback } from "react";

export function useNixInstall() {
  const checkNix = useCallback(async () => {
    try {
      const result = await darwinAPI.nix.check();
      const store = useWidgetStore.getState();
      store.setNixInstalled(result.installed);
      store.setDarwinRebuildAvailable(result.installed ? result.darwin_rebuild_available : null);
    } catch {
      useWidgetStore.getState().setNixInstalled(false);
    }
  }, []);

  const installNix = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setNixInstalling(true);
    store.setNixInstallPhase(null);
    store.setNixDownloadProgress(null);
    store.setError(null);

    const unlistenProgress = await ipcRenderer.on<{
      phase: "downloading" | "waiting-for-installer" | "prefetching";
      downloaded?: number;
      total?: number;
    }>("nix:install:progress", (event) => {
      const current = useWidgetStore.getState();
      current.setNixInstallPhase(event.payload.phase);
      if (event.payload.phase === "downloading" && event.payload.downloaded != null) {
        current.setNixDownloadProgress({
          downloaded: event.payload.downloaded,
          total: event.payload.total ?? 0,
        });
      }
    });

    const unlistenEnd = await ipcRenderer.on<{
      ok: boolean;
      code: number;
      nix_version?: string;
      darwin_rebuild_available?: boolean;
      error_type?: string;
      error?: string;
    }>("nix:install:end", (event) => {
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
      await darwinAPI.nix.installStart();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setNixInstalling(false);
      store.setNixInstallPhase(null);
      store.setNixDownloadProgress(null);
      store.setError(msg);
      unlistenProgress();
      unlistenEnd();
    }
  }, []);

  const prefetchDarwinRebuild = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setDarwinRebuildPrefetching(true);
    store.setError(null);

    const unlistenEnd = await ipcRenderer.on<{
      ok: boolean;
      error?: string;
    }>("nix:darwin-rebuild:end", (event) => {
      const current = useWidgetStore.getState();
      current.setDarwinRebuildPrefetching(false);
      current.setDarwinRebuildAvailable(event.payload.ok);

      if (!event.payload.ok) {
        current.setError(event.payload.error ?? "Failed to set up nix-darwin.");
      }

      unlistenEnd();
    });

    try {
      await darwinAPI.nix.prefetchDarwinRebuild();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setDarwinRebuildPrefetching(false);
      store.setError(msg);
      unlistenEnd();
    }
  }, []);

  return { checkNix, installNix, prefetchDarwinRebuild };
}
