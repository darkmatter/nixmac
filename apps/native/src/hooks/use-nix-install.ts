import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI, ipcRenderer } from "@/ipc/api";
import { getTelemetry } from "@/lib/telemetry/instance";
import type {
  NixSetupTarget,
  NixSetupTrigger,
} from "@/lib/telemetry/events";
import type {
  NixDarwinRebuildEndEvent,
  NixInstallEndEvent,
  NixInstallProgressEvent,
} from "@/ipc/types";

const captureNixSetupStarted = (
  target: NixSetupTarget,
  trigger: NixSetupTrigger,
) => {
  getTelemetry().captureEvent({
    name: "nix_setup_started",
    props: { target, trigger },
  });
};

const captureNixSetupFinished = (target: NixSetupTarget, ok: boolean) => {
  getTelemetry().captureEvent({
    name: ok ? "nix_setup_completed" : "nix_setup_failed",
    props: { target },
  });
};

const resolveInstallEndTarget = (
  startedTarget: NixSetupTarget,
  payload: NixInstallEndEvent,
  phase: NixInstallProgressEvent["phase"] | null,
): NixSetupTarget => {
  if (
    !payload.ok &&
    (payload.error_type === "darwin_rebuild" || phase === "prefetching")
  ) {
    return "nix_darwin";
  }
  return startedTarget;
};

const checkNix = async () => {
    try {
      const result = await tauriAPI.nix.check();
      const store = useWidgetStore.getState();
      store.setNixInstalled(result.installed);
      store.setDarwinRebuildAvailable(result.installed ? result.darwinRebuildAvailable : null);
    } catch {
      useWidgetStore.getState().setNixInstalled(false);
    }
};

const installNix = async (trigger: NixSetupTrigger = "user") => {
    const store = useWidgetStore.getState();
    const target: NixSetupTarget = store.nixInstalled ? "nix_darwin" : "nix";
    captureNixSetupStarted(target, trigger);
    store.setNixInstalling(true);
    store.setNixInstallPhase(null);
    store.setNixDownloadProgress(null);
    store.setError(null);

    const unlistenProgress = await ipcRenderer.on<NixInstallProgressEvent>("nix:install:progress", (event) => {
      const current = useWidgetStore.getState();
      current.setNixInstallPhase(event.payload.phase);
      if (event.payload.phase === "downloading" && event.payload.downloaded != null) {
        current.setNixDownloadProgress({
          downloaded: event.payload.downloaded,
          total: event.payload.total ?? 0,
        });
      }
    });

    const unlistenEnd = await ipcRenderer.on<NixInstallEndEvent>("nix:install:end", (event) => {
      const current = useWidgetStore.getState();
      const terminalTarget = resolveInstallEndTarget(
        target,
        event.payload,
        current.nixInstallPhase,
      );
      current.setNixInstalling(false);
      current.setNixInstallPhase(null);
      current.setNixDownloadProgress(null);
      current.setNixInstalled(event.payload.ok);
      current.setDarwinRebuildAvailable(event.payload.darwin_rebuild_available ?? false);
      captureNixSetupFinished(terminalTarget, event.payload.ok);

      if (!event.payload.ok) {
        current.setError(
          event.payload.error ?? "Installation failed. Please install manually.",
        );
      }

      unlistenProgress();
      unlistenEnd();
    });

    try {
      await tauriAPI.nix.installStart();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setNixInstalling(false);
      store.setNixInstallPhase(null);
      store.setNixDownloadProgress(null);
      store.setError(msg);
      captureNixSetupFinished(target, false);
      unlistenProgress();
      unlistenEnd();
    }
};

const prefetchDarwinRebuild = async () => {
    const store = useWidgetStore.getState();
    captureNixSetupStarted("nix_darwin", "automatic");
    store.setDarwinRebuildPrefetching(true);
    store.setError(null);

    const unlistenEnd = await ipcRenderer.on<NixDarwinRebuildEndEvent>("nix:darwin-rebuild:end", (event) => {
      const current = useWidgetStore.getState();
      current.setDarwinRebuildPrefetching(false);
      current.setDarwinRebuildAvailable(event.payload.ok);
      captureNixSetupFinished("nix_darwin", event.payload.ok);

      if (!event.payload.ok) {
        current.setError(event.payload.error ?? "Failed to set up nix-darwin.");
      }

      unlistenEnd();
    });

    try {
      await tauriAPI.nix.prefetchDarwinRebuild();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setDarwinRebuildPrefetching(false);
      store.setError(msg);
      captureNixSetupFinished("nix_darwin", false);
      unlistenEnd();
    }
};

export function useNixInstall() {
  return { checkNix, installNix, prefetchDarwinRebuild };
}
