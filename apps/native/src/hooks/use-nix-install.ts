import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI, ipcRenderer } from "@/tauri-api";
import { useCallback } from "react";

export function useNixInstall() {
  const checkNix = useCallback(async () => {
    try {
      const result = await darwinAPI.nix.check();
      useWidgetStore.getState().setNixInstalled(result.installed);
    } catch {
      useWidgetStore.getState().setNixInstalled(false);
    }
  }, []);

  const installNix = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setNixInstalling(true);
    store.setError(null);

    const unlistenEnd = await ipcRenderer.on<{
      ok: boolean;
      code: number;
      nix_version?: string;
      error_type?: string;
      error?: string;
    }>("nix:install:end", (event) => {
      const current = useWidgetStore.getState();
      current.setNixInstalling(false);
      current.setNixInstalled(event.payload.ok);

      if (!event.payload.ok) {
        current.setError(
          event.payload.error ?? "Installation failed. Please install manually.",
        );
      }

      unlistenEnd();
    });

    try {
      await darwinAPI.nix.installStart();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setNixInstalling(false);
      store.setError(msg);
      unlistenEnd();
    }
  }, []);

  return { checkNix, installNix };
}
