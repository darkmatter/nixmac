import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback, useRef } from "react";

export function useDarwinConfig() {
  const isBootstrapping = useWidgetStore((state) => state.isBootstrapping);
  const storeRef = useRef(useWidgetStore.getState());

  const pickDir = useCallback(async () => {
    const dir = (await darwinAPI.config.pickDir()) as string | null;
    if (!dir) {
      return;
    }

    const store = storeRef.current;
    store.setConfigDir(dir);
    store.setHost("");
    try {
      await darwinAPI.config.setHostAttr("");
    } catch {
    }

    // Check if flake exists and load hosts
    try {
      const hosts = await darwinAPI.flake.listHosts();
      if (Array.isArray(hosts)) {
        store.setHosts(hosts);
      } else {
        store.setHosts([]);
      }
    } catch {
      // No flake.nix found - shows bootstrap interface
      store.setHosts([]);
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
        const hosts = await darwinAPI.flake.listHosts();

        if (Array.isArray(hosts) && hosts.length > 0) {
          store.setHosts(hosts);

          if (hosts[0]) {
            await darwinAPI.config.setHostAttr(hosts[0]);
            store.setHost(hosts[0]);
          }
        }
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