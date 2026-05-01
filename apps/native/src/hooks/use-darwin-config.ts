import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import type { SetDirResult } from "@/types/shared";
import { useCallback, useRef } from "react";

export function useDarwinConfig() {
  const isBootstrapping = useWidgetStore((state) => state.isBootstrapping);
  const storeRef = useRef(useWidgetStore.getState());

  const applyDirResult = useCallback(async (result: SetDirResult) => {
    const store = storeRef.current;
    store.setConfigDir(result.dir);
    if (result.evolveState) {
      store.setEvolveState(result.evolveState);
      store.setGitStatus(null);
      store.setHost("");
      try {
        await darwinAPI.config.setHostAttr("");
      } catch {}
      store.setHosts(result.hosts ?? []);
    }
  }, []);

  const setDir = useCallback(
    async (dir: string) => {
      const result = await darwinAPI.config.setDir(dir);
      await applyDirResult(result);
      return result;
    },
    [applyDirResult]
  );

  const pickDir = useCallback(async () => {
    const result = await darwinAPI.config.pickDir();
    if (!result) return;
    await applyDirResult(result);
  }, [applyDirResult]);

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
      const commitExisting = !hostname.trim();
      const store = storeRef.current;
      store.setError(null);
      store.setBootstrapping(true);

      try {
        await darwinAPI.flake.bootstrapDefault(hostname);

        if (commitExisting) {
          const hosts = await darwinAPI.flake.listHosts();
          store.setHosts(hosts);
          if (hosts.length === 1) {
            await darwinAPI.config.setHostAttr(hosts[0]);
            store.setHost(hosts[0]);
          }
        } else {
          // Set the host directly from the hostname used for bootstrap.
          // We can't call listHosts() here because Nix may not be installed yet
          // (listHosts requires `nix eval` which needs Nix).
          store.setHosts([hostname]);
          await darwinAPI.config.setHostAttr(hostname);
          store.setHost(hostname);
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

  return { setDir, pickDir, saveHost, bootstrap, isBootstrapping };
}