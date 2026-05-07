import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import type { SetDirResult } from "@/types/shared";

const applyDirResult = async (result: SetDirResult) => {
  const store = useWidgetStore.getState();
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
};

const setDir = async (dir: string) => {
  const result = await darwinAPI.config.setDir(dir);
  await applyDirResult(result);
  return result;
};

const prepareNewDir = async (dir: string) => {
  const result = await darwinAPI.config.prepareNewDir(dir);
  await applyDirResult(result);
  return result;
};

const pickDir = async () => {
  const result = await darwinAPI.config.pickDir();
  if (!result) return;
  await applyDirResult(result);
  return result;
};

const saveHost = async (host: string) => {
  const store = useWidgetStore.getState();

  try {
    await darwinAPI.config.setHostAttr(host);
    store.setHost(host);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    store.setError(`Failed to save host: ${message}`);
  }
};

const bootstrap = async (hostname: string) => {
  const commitExisting = !hostname.trim();
  const store = useWidgetStore.getState();
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
};

export function useDarwinConfig() {
  const isBootstrapping = useWidgetStore((state) => state.isBootstrapping);

  return { setDir, prepareNewDir, pickDir, saveHost, bootstrap, isBootstrapping };
}
