import { uiActions, useUiState } from "@nixmac/state";
import type { SetDirResult } from "@/ipc/orpc-bindings";
import type { StarterTemplateId } from "@/components/widget/onboarding/lib/flake-ref";
import { tauriAPI } from "@/ipc/api";
import { client } from "@/lib/orpc";

interface DarwinConfigActions {
  setDir: (dir: string) => Promise<SetDirResult>;
  prepareNewDir: (dir: string) => Promise<SetDirResult>;
  pickDir: () => Promise<SetDirResult | undefined>;
  saveHost: (host: string) => Promise<void>;
  bootstrap: (hostname: string, templateId?: StarterTemplateId) => Promise<void>;
  isBootstrapping: boolean;
  importGithub: (repoRef: string, dirName?: string) => Promise<SetDirResult>;
  importZip: (zipPath: string, dirName?: string) => Promise<SetDirResult>;
  pickZip: () => Promise<string | null>;
}

// Config dir/host/hosts and the evolve/git mirrors are no longer written
// locally: the backend emits `*_changed` events after these mutations and the
// sync modules mirror the new values (and re-list hosts) into the ViewModel.
const applyDirResult = async (result: SetDirResult) => {
  if (result.changed) {
    try {
      await client.config.setHostAttr({ host: "" });
    } catch {}
  }
};

const setDir = async (dir: string) => {
  const result = await client.config.setDir({ dir });
  await applyDirResult(result);
  return result;
};

const prepareNewDir = async (dir: string) => {
  const result = await client.config.prepareNewDir({ dir });
  await applyDirResult(result);
  return result;
};

const pickDir = async () => {
  const result = await client.config.pickDir();
  if (!result) return;
  await applyDirResult(result);
  return result;
};

const importGithub = async (repoRef: string, dirName?: string) => {
  const result = await client.config.importGithub({
    repoRef,
    dirName: dirName ?? null,
  });
  await applyDirResult(result);
  return result;
};

const importZip = async (zipPath: string, dirName?: string) => {
  const result = await client.config.importZip({
    zipPath,
    dirName: dirName ?? null,
  });
  await applyDirResult(result);
  return result;
};

const pickZip = () => client.config.pickZip();

const saveHost = async (host: string) => {
  try {
    await client.config.setHostAttr({ host });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    uiActions.setError(`Failed to save host: ${message}`);
  }
};

const bootstrap = async (hostname: string, templateId?: StarterTemplateId) => {
  const commitExisting = !hostname.trim();
  uiActions.setError(null);
  uiActions.setBootstrapping(true);

  try {
    await client.flake.bootstrapDefault({
      hostname,
      templateId: templateId ?? null,
    });

    if (commitExisting) {
      const hosts = await tauriAPI.flake.listHosts();
      if (hosts.length === 1) {
        await client.config.setHostAttr({ host: hosts[0] });
      }
    } else {
      // Set the host directly from the hostname used for bootstrap.
      // We can't call listHosts() here because Nix may not be installed yet
      // (listHosts requires `nix eval` which needs Nix).
      await client.config.setHostAttr({ host: hostname });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    uiActions.setError(`Failed to create configuration: ${message}`);
  } finally {
    uiActions.setBootstrapping(false);
  }
};

export function useDarwinConfig(): DarwinConfigActions {
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
