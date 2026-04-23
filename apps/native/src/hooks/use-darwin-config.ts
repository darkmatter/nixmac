import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback, useRef } from "react";

export function useDarwinConfig() {
  const isBootstrapping = useWidgetStore((state) => state.isBootstrapping);
  const storeRef = useRef(useWidgetStore.getState());

  const pickDir = useCallback(async () => {
    const result = await darwinAPI.config.pickDir();
    if (!result) {
      return;
    }

    const store = storeRef.current;
    store.setConfigDir(result.dir);
    if (result.evolveState) {
      store.setEvolveState(result.evolveState);
      store.setHost("");
      try {
        await darwinAPI.config.setHostAttr("");
      } catch {
      }
      store.setHosts(result.hosts ?? []);
    }
  }, []);

  const saveHost = useCallback(
    async (host: string) => {
      const store = storeRef.current;

      try {
        await darwinAPI.config.setHostAttr(host);
        store.setHost(host);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        store.setError(`Failed to save host: ${message}`);
      }
    },
    []
  );

  const bootstrap = useCallback(
    async (hostname: string) => {
      if (!hostname.trim()) {
        return;
      }

      const store = storeRef.current;
      store.setError(null);
      store.setBootstrapping(true);

      try {
        await darwinAPI.flake.bootstrapDefault(hostname);

        // Set the host directly from the hostname used for bootstrap.
        // We can't call listHosts() here because Nix may not be installed yet
        // (listHosts requires `nix eval` which needs Nix).
        store.setHosts([hostname]);
        await darwinAPI.config.setHostAttr(hostname);
        store.setHost(hostname);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        store.setError(`Failed to create configuration: ${message}`);
      } finally {
        store.setBootstrapping(false);
      }
    },
    []
  );

  return { pickDir, saveHost, bootstrap, isBootstrapping };
}