import { useUiState } from "@/stores/ui-state";
import { tauriAPI } from "@/ipc/api";
import type { SetDirResult } from "@/ipc/types";

// Config dir/host/hosts and the evolve/git mirrors are no longer written
// locally: the backend emits `*_changed` events after these mutations and the
// sync modules mirror the new values (and re-list hosts) into the ViewModel.
const applyDirResult = async (result: SetDirResult) => {
  if (result.changed) {
    try {
      await tauriAPI.config.setHostAttr("");
    } catch {}
  }
};

const setDir = async (dir: string) => {
  const result = await tauriAPI.config.setDir(dir);
  await applyDirResult(result);
  return result;
};

const prepareNewDir = async (dir: string) => {
  const result = await tauriAPI.config.prepareNewDir(dir);
  await applyDirResult(result);
  return result;
};

const pickDir = async () => {
  const result = await tauriAPI.config.pickDir();
  if (!result) return;
  await applyDirResult(result);
  return result;
};

const importGithub = async (repoRef: string, dirName?: string) => {
  const result = await tauriAPI.config.importGithub(repoRef, dirName);
  await applyDirResult(result);
  return result;
};

const importZip = async (zipPath: string, dirName?: string) => {
  const result = await tauriAPI.config.importZip(zipPath, dirName);
  await applyDirResult(result);
  return result;
};

const pickZip = () => tauriAPI.config.pickZip();

const saveHost = async (host: string) => {
  try {
    await tauriAPI.config.setHostAttr(host);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    useUiState.getState().setError(`Failed to save host: ${message}`);
  }
};

const bootstrap = async (hostname: string) => {
  const commitExisting = !hostname.trim();
  const ui = useUiState.getState();
  ui.setError(null);
  ui.setBootstrapping(true);

  try {
    await tauriAPI.flake.bootstrapDefault(hostname);

    if (commitExisting) {
      const hosts = await tauriAPI.flake.listHosts();
      if (hosts.length === 1) {
        await tauriAPI.config.setHostAttr(hosts[0]);
      }
    } else {
      // Set the host directly from the hostname used for bootstrap.
      // We can't call listHosts() here because Nix may not be installed yet
      // (listHosts requires `nix eval` which needs Nix).
      await tauriAPI.config.setHostAttr(hostname);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    ui.setError(`Failed to create configuration: ${message}`);
  } finally {
    ui.setBootstrapping(false);
  }
};

export function useDarwinConfig() {
  const isBootstrapping = useUiState((state) => state.isBootstrapping);

  return {
    setDir,
    prepareNewDir,
    pickDir,
    saveHost,
    bootstrap,
    isBootstrapping,
    importGithub,
    importZip,
    pickZip,
  };
}
