import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import type { SetDirResult } from "@/ipc/types";
import { getTelemetry } from "@/lib/telemetry/instance";
import type { SetupSource } from "@/lib/telemetry/events";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";

export type TelemetrySurface = "onboarding" | "settings";

type TelemetryOptions = {
  telemetrySurface?: TelemetrySurface;
};

const captureConfigDirectoryCompleted = (source: SetupSource) => {
  getTelemetry().captureEvent({
    name: "onboarding_step_completed",
    props: { source, step: "config_directory" },
  });
};

const applyDirResult = async (
  result: SetDirResult,
  source: SetupSource,
  options: TelemetryOptions = {},
) => {
  const store = useWidgetStore.getState();
  store.setConfigDir(result.dir);
  if (result.evolveState) {
    mirrorEvolveState(result.evolveState);
    mirrorGitState(null);
    store.setHost("");
    try {
      await tauriAPI.config.setHostAttr("");
    } catch {}
    store.setHosts(result.hosts ?? []);
  }
  if (options.telemetrySurface === "onboarding") {
    captureConfigDirectoryCompleted(source);
  }
};

const setDir = async (dir: string, options?: TelemetryOptions) => {
  const result = await tauriAPI.config.setDir(dir);
  await applyDirResult(result, "manual", options);
  return result;
};

const prepareNewDir = async (dir: string, options?: TelemetryOptions) => {
  const result = await tauriAPI.config.prepareNewDir(dir);
  await applyDirResult(result, "manual", options);
  return result;
};

const pickDir = async (options?: TelemetryOptions) => {
  const result = await tauriAPI.config.pickDir();
  if (!result) return;
  await applyDirResult(result, "picker", options);
  return result;
};

const importGithub = async (
  repoRef: string,
  dirName?: string,
  options?: TelemetryOptions,
) => {
  const result = await tauriAPI.config.importGithub(repoRef, dirName);
  await applyDirResult(result, "github_import", options);
  return result;
};

const importZip = async (
  zipPath: string,
  dirName?: string,
  options?: TelemetryOptions,
) => {
  const result = await tauriAPI.config.importZip(zipPath, dirName);
  await applyDirResult(result, "zip_import", options);
  return result;
};

const pickZip = () => tauriAPI.config.pickZip();

const saveHost = async (host: string, options: TelemetryOptions = {}) => {
  const store = useWidgetStore.getState();

  try {
    await tauriAPI.config.setHostAttr(host);
    store.setHost(host);
    if (options.telemetrySurface === "onboarding") {
      getTelemetry().captureEvent({
        name: "onboarding_step_completed",
        props: { step: "host_configuration" },
      });
      getTelemetry().captureEvent({
        name: "onboarding_completed",
        props: { step: "host_configuration" },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    store.setError(`Failed to save host: ${message}`);
  }
};

const bootstrap = async (hostname: string, _options: TelemetryOptions = {}) => {
  const commitExisting = !hostname.trim();
  const store = useWidgetStore.getState();
  store.setError(null);
  store.setBootstrapping(true);

  try {
    await tauriAPI.flake.bootstrapDefault(hostname);

    if (commitExisting) {
      const hosts = await tauriAPI.flake.listHosts();
      store.setHosts(hosts);
      if (hosts.length === 1) {
        await tauriAPI.config.setHostAttr(hosts[0]);
        store.setHost(hosts[0]);
      }
    } else {
      // Set the host directly from the hostname used for bootstrap.
      // We can't call listHosts() here because Nix may not be installed yet
      // (listHosts requires `nix eval` which needs Nix).
      store.setHosts([hostname]);
      await tauriAPI.config.setHostAttr(hostname);
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
