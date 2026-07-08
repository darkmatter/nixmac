import { uiActions, useUiState } from "@nixmac/state";
import type { ImportConfigResult, SetDirResult } from "@/ipc/orpc-bindings";
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
  importGithub: (repoRef: string, dirName?: string) => Promise<ImportConfigResult>;
  importZip: (zipPath: string, dirName?: string) => Promise<ImportConfigResult>;
  pickZip: () => Promise<string | null>;
  createFromTemplate: (
    templateRef: string,
    hostname: string,
    dirName?: string,
  ) => Promise<SetDirResult>;
}

// Config dir/host/hosts and the evolve/git mirrors are no longer written
// locally: the backend emits `*_changed` events after these mutations and the
// sync modules mirror the new values (and re-list hosts) into the ViewModel.
const applyDirResult = async (result: SetDirResult, stage: boolean) => {
  if (result.changed) {
    try {
      await client.config.setHostAttr({ host: "", stage });
    } catch {}
  }
};

/**
 * Post-import bookkeeping shared by every import surface (including the
 * GitHub picker, which imports via `client.github.import`): a config dir
 * change invalidates the previously selected host.
 */
export const applyImportResult = async (result: ImportConfigResult) => {
  if (result.status === "imported" && result.changed) {
    try {
      // Imports are wizard-only surfaces: the cleared host is staged.
      await client.config.setHostAttr({ host: "", stage: true });
    } catch {}
  }
};

const setDir = async (dir: string, stage: boolean) => {
  const result = await client.config.setDir({ dir, stage });
  await applyDirResult(result, stage);
  return result;
};

const prepareNewDir = async (dir: string, stage: boolean) => {
  const result = await client.config.prepareNewDir({ dir, stage });
  await applyDirResult(result, stage);
  return result;
};

const pickDir = async (stage: boolean) => {
  const result = await client.config.pickDir({ stage });
  if (!result) return;
  await applyDirResult(result, stage);
  return result;
};

const importGithub = async (repoRef: string, dirName?: string) => {
  const result = await client.config.importGithub({
    repoRef,
    dirName: dirName ?? null,
  });
  await applyImportResult(result);
  return result;
};

const importZip = async (zipPath: string, dirName?: string) => {
  const result = await client.config.importZip({
    zipPath,
    dirName: dirName ?? null,
  });
  await applyImportResult(result);
  return result;
};

const pickZip = () => client.config.pickZip();

/**
 * Scaffolds a new configuration from a remote template repository. Atomic on
 * the backend: the config dir is only selected on success. No applyDirResult
 * here — the backend owns the host attribute for template creates (it adopts
 * the chosen hostname when the template is host-parameterized, and clears it
 * otherwise), so a client-side reset would wipe that decision.
 */
const createFromTemplate = async (templateRef: string, hostname: string, dirName?: string) => {
  return client.config.createFromTemplate({
    templateRef,
    hostname,
    dirName: dirName ?? null,
  });
};

const saveHost = async (host: string, stage: boolean) => {
  try {
    await client.config.setHostAttr({ host, stage });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    uiActions.setError(`Failed to save host: ${message}`);
  }
};

const bootstrap = async (hostname: string, stage: boolean, templateId?: StarterTemplateId) => {
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
        await client.config.setHostAttr({ host: hosts[0], stage });
      }
    } else {
      // Set the host directly from the hostname used for bootstrap.
      // We can't call listHosts() here because Nix may not be installed yet
      // (listHosts requires `nix eval` which needs Nix).
      await client.config.setHostAttr({ host: hostname, stage });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    uiActions.setError(`Failed to create configuration: ${message}`);
  } finally {
    uiActions.setBootstrapping(false);
  }
};

/**
 * Config-selection actions, bound to an explicit destination: the onboarding
 * UI passes `stage: true` (selections land on `OnboardingState` and are
 * committed to preferences by the first successful apply); the preferences
 * UI uses the default and writes preferences directly. The context is a
 * caller decision, never inferred.
 */
export function useDarwinConfig({ stage = false }: { stage?: boolean } = {}): DarwinConfigActions {
  const isBootstrapping = useUiState((state) => state.isBootstrapping);

  return {
    setDir: (dir) => setDir(dir, stage),
    prepareNewDir: (dir) => prepareNewDir(dir, stage),
    pickDir: () => pickDir(stage),
    saveHost: (host) => saveHost(host, stage),
    bootstrap: (hostname, templateId) => bootstrap(hostname, stage, templateId),
    isBootstrapping,
    importGithub,
    importZip,
    pickZip,
    createFromTemplate,
  };
}
